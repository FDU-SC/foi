import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { resolveUser } from "@/lib/accounts/resolve";
import type { JobDetails, JobTicket, Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { judgingAttempts, judgingQueue, runners, submissions } from "@/lib/db/schema";
import { isInlineBackend } from "@/lib/problems/types";
import { problemBySlug } from "@/lib/problems/registry";
import { invalidateStandings } from "@/lib/standings/cache";
import { publish } from "@/lib/submissions/events";

export const HEARTBEAT_LAPSE_MS = 90_000;

export const MAX_ATTEMPTS = 3;

export const QUEUE_FUSE_MS = 6 * 60 * 60_000;

export const RUNNER_ONLINE_MS = 60_000;

function mintLease(): string {
  return randomBytes(32).toString("base64url");
}

async function markRunnerSeen(
  backendId: string,
  runnerId: string,
): Promise<void> {
  const lastSeenAt = new Date();
  await db
    .insert(runners)
    .values({ backendId, runnerId, lastSeenAt })
    .onConflictDoUpdate({
      target: [runners.backendId, runners.runnerId],
      set: { lastSeenAt },
    });
}

export async function claimJob(
  backendId: string,
  runnerId: string,
): Promise<JobTicket | null> {
  await markRunnerSeen(backendId, runnerId);

  const next = db
    .select({ submissionId: judgingQueue.submissionId })
    .from(judgingQueue)
    .where(
      and(
        eq(judgingQueue.state, "waiting"),
        eq(judgingQueue.backendId, backendId),
        lt(judgingQueue.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(desc(judgingQueue.priority), asc(judgingQueue.queuedAt))
    .limit(1)
    .for("update", { skipLocked: true });

  const lease = mintLease();
  const now = new Date();

  const [claimed] = await db
    .update(judgingQueue)
    .set({
      state: "claimed",
      runnerId,
      lease,
      heartbeatAt: now,
      claimedAt: now,
      runnerStatus: null,
      attempts: sql`${judgingQueue.attempts} + 1`,
    })
    .where(eq(judgingQueue.submissionId, next))
    .returning();

  if (!claimed) return null;

  await db.insert(judgingAttempts).values({
    submissionId: claimed.submissionId,
    backendId,
    runnerId,
    claimedAt: now,
  });

  await publish(db, claimed.submissionId, { state: "judging" });

  return { id: claimed.submissionId, lease };
}

export async function jobDetails(
  id: string,
  lease: string,
): Promise<JobDetails | null> {
  const [row] = await db
    .select()
    .from(submissions)
    .innerJoin(
      judgingQueue,
      eq(submissions.id, judgingQueue.submissionId),
    )
    .where(
      and(
        eq(submissions.id, id),
        eq(judgingQueue.lease, lease),
        eq(judgingQueue.state, "claimed"),
      ),
    )
    .limit(1);

  if (!row) return null;

  const sub = row.submissions;
  const problem = problemBySlug(sub.problemSlug);
  const config =
    problem && !isInlineBackend(problem.backend)
      ? problem.backend.config
      : null;

  const user = await resolveUser(sub.uid);

  return {
    id: sub.id,
    user: { uid: sub.uid, groups: user?.groups ?? [] },
    problem: { slug: sub.problemSlug, config },
    contestSlug: sub.contestSlug,
    payload: sub.payload,
  };
}

function heldBy(id: string, lease: string) {
  return and(
    eq(judgingQueue.submissionId, id),
    eq(judgingQueue.lease, lease),
  );
}

export async function reportAlive(
  id: string,
  lease: string,
  status?: string,
): Promise<boolean> {
  const [updated] = await db
    .update(judgingQueue)
    .set({
      heartbeatAt: new Date(),
      ...(status === undefined ? {} : { runnerStatus: status }),
    })
    .where(heldBy(id, lease))
    .returning();

  if (!updated) return false;

  if (status !== undefined) {
    await publish(db, id, { state: "judging", runnerStatus: status });
  }
  return true;
}

export async function reportDone(
  id: string,
  lease: string,
  verdict: Verdict,
  backendVersion: string,
): Promise<boolean> {
  const [queueRow] = await db
    .select({
      submissionId: judgingQueue.submissionId,
      runnerId: judgingQueue.runnerId,
      runnerStatus: judgingQueue.runnerStatus,
    })
    .from(judgingQueue)
    .where(heldBy(id, lease))
    .limit(1);

  if (!queueRow) return false;

  const [sub] = await db
    .select({
      problemSlug: submissions.problemSlug,
      contestSlug: submissions.contestSlug,
    })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  if (!sub) return false;

  await db
    .update(submissions)
    .set({
      state: "completed",
      result: verdict.result,
      detail: verdict.detail ?? null,
      backendVersion,
      error: null,
      judgedAt: new Date(),
    })
    .where(eq(submissions.id, id));

  await db
    .delete(judgingQueue)
    .where(eq(judgingQueue.submissionId, id));

  await db
    .update(judgingAttempts)
    .set({ finishedAt: new Date(), outcome: "completed", lastStatus: queueRow.runnerStatus })
    .where(
      and(
        eq(judgingAttempts.submissionId, id),
        eq(judgingAttempts.runnerId, queueRow.runnerId!),
        eq(judgingAttempts.outcome, sql`null`),
      ),
    );

  await publish(db, id, { state: "completed" });
  if (sub.contestSlug) invalidateStandings(sub.contestSlug);
  return true;
}

export async function reportFailed(
  id: string,
  lease: string,
  reason: string,
  backendVersion: string,
): Promise<boolean> {
  const [queueRow] = await db
    .select({
      submissionId: judgingQueue.submissionId,
      attempts: judgingQueue.attempts,
      runnerId: judgingQueue.runnerId,
      runnerStatus: judgingQueue.runnerStatus,
    })
    .from(judgingQueue)
    .where(heldBy(id, lease))
    .limit(1);

  if (!queueRow) return false;

  const exhausted = queueRow.attempts >= MAX_ATTEMPTS;

  if (exhausted) {
    await db
      .update(submissions)
      .set({
        state: "disrupted",
        backendVersion,
        error: reason,
        judgedAt: new Date(),
      })
      .where(eq(submissions.id, id));

    await db
      .delete(judgingQueue)
      .where(eq(judgingQueue.submissionId, id));

    await publish(db, id, { state: "disrupted" });
  } else {
    await db
      .update(judgingQueue)
      .set({
        state: "waiting",
        runnerId: null,
        lease: null,
        runnerStatus: null,
        heartbeatAt: null,
        claimedAt: null,
        queuedAt: sql`now()`,
      })
      .where(eq(judgingQueue.submissionId, id));

    await publish(db, id, { state: "queued" });
  }

  await db
    .update(judgingAttempts)
    .set({ finishedAt: new Date(), outcome: "failed", error: reason, lastStatus: queueRow.runnerStatus })
    .where(
      and(
        eq(judgingAttempts.submissionId, id),
        eq(judgingAttempts.runnerId, queueRow.runnerId!),
        eq(judgingAttempts.outcome, sql`null`),
      ),
    );

  return true;
}

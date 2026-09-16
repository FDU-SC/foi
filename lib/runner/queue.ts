import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
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

  return db.transaction(async (tx) => {
  const next = tx
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

  const [claimed] = await tx
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

  await tx.insert(judgingAttempts).values({
    submissionId: claimed.submissionId,
    backendId,
    runnerId,
    claimedAt: now,
  });

  await publish(tx, claimed.submissionId, { state: "judging" });

  return { id: claimed.submissionId, lease };
  });
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
    eq(judgingQueue.state, "claimed"),
  );
}

export async function reportAlive(
  id: string,
  lease: string,
  status?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
  const [updated] = await tx
    .update(judgingQueue)
    .set({
      heartbeatAt: new Date(),
      ...(status === undefined ? {} : { runnerStatus: status }),
    })
    .where(heldBy(id, lease))
    .returning();

  if (!updated) return false;

  if (status !== undefined) {
    await publish(tx, id, { state: "judging", runnerStatus: status });
  }
  return true;
  });
}

async function settleJob(
  id: string,
  lease: string,
  backendVersion: string,
  outcome: { kind: "completed"; verdict: Verdict } | { kind: "failed"; reason: string },
): Promise<boolean> {
  const settled = await db.transaction(async (tx) => {
    const [queueRow] = await tx
      .select()
      .from(judgingQueue)
      .where(heldBy(id, lease))
      .for("update");
    if (!queueRow) return undefined;

    const now = new Date();
    const [sub] = await tx
      .update(submissions)
      .set({
        ...(outcome.kind === "completed"
          ? {
              state: "completed" as const,
              result: outcome.verdict.result,
              detail: outcome.verdict.detail ?? null,
              error: null,
            }
          : { state: "disrupted" as const, error: outcome.reason }),
        backendVersion,
        judgedAt: now,
      })
      .where(eq(submissions.id, id))
      .returning({ contestSlug: submissions.contestSlug });

    await tx
      .update(judgingAttempts)
      .set({
        finishedAt: now,
        outcome: outcome.kind,
        lastStatus: queueRow.runnerStatus,
        ...(outcome.kind === "failed" ? { error: outcome.reason } : {}),
      })
      .where(
        and(
          eq(judgingAttempts.submissionId, id),
          eq(judgingAttempts.runnerId, queueRow.runnerId!),
          eq(judgingAttempts.claimedAt, queueRow.claimedAt!),
          isNull(judgingAttempts.outcome),
        ),
      );

    await tx.delete(judgingQueue).where(heldBy(id, lease));
    await publish(tx, id, {
      state: outcome.kind === "completed" ? "completed" : "disrupted",
    });
    return sub;
  });

  if (!settled) return false;
  if (outcome.kind === "completed") invalidateStandings(settled.contestSlug);
  return true;
}

export async function reportDone(
  id: string,
  lease: string,
  verdict: Verdict,
  backendVersion: string,
): Promise<boolean> {
  return settleJob(id, lease, backendVersion, { kind: "completed", verdict });
}

export async function reportFailed(
  id: string,
  lease: string,
  reason: string,
  backendVersion: string,
): Promise<boolean> {
  return settleJob(id, lease, backendVersion, { kind: "failed", reason });
}

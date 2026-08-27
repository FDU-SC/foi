import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { resolveUser } from "@/lib/accounts/resolve";
import type { JobDetails, JobTicket, Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { judgingSessions, runners, submissions } from "@/lib/db/schema";
import { isInlineBackend } from "@/lib/problems/types";
import { problemBySlug } from "@/lib/problems/registry";
import { invalidateStandings } from "@/lib/standings/cache";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { verdictColumns } from "@/lib/submissions/verdict";

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
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.state, "queued"),
        eq(submissions.backendId, backendId),
        lt(submissions.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(submissions.queuedAt))
    .limit(1)
    .for("update", { skipLocked: true });

  const lease = mintLease();
  const now = new Date();

  const [claimed] = await db
    .update(submissions)
    .set({
      state: "judging",
      error: null,
      attempts: sql`${submissions.attempts} + 1`,
    })
    .where(inArray(submissions.id, next))
    .returning();

  if (!claimed) return null;

  await db
    .insert(judgingSessions)
    .values({
      submissionId: claimed.id,
      runnerId,
      lease,
      runnerStatus: null,
      lastHeartbeatAt: now,
      claimedAt: now,
    })
    .onConflictDoUpdate({
      target: judgingSessions.submissionId,
      set: {
        runnerId,
        lease,
        runnerStatus: null,
        lastHeartbeatAt: now,
        claimedAt: now,
      },
    });

  publish(toView(claimed));
  return { id: claimed.id, lease };
}

export async function jobDetails(
  id: string,
  lease: string,
): Promise<JobDetails | null> {
  const [row] = await db
    .select()
    .from(submissions)
    .innerJoin(
      judgingSessions,
      eq(submissions.id, judgingSessions.submissionId),
    )
    .where(
      and(
        eq(submissions.id, id),
        eq(judgingSessions.lease, lease),
        eq(submissions.state, "judging"),
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
    eq(judgingSessions.submissionId, id),
    eq(judgingSessions.lease, lease),
  );
}

export async function reportAlive(
  id: string,
  lease: string,
  status?: string,
): Promise<boolean> {
  const [updated] = await db
    .update(judgingSessions)
    .set({
      lastHeartbeatAt: new Date(),
      ...(status === undefined ? {} : { runnerStatus: status }),
    })
    .where(heldBy(id, lease))
    .returning();

  if (!updated) return false;

  if (status !== undefined) {
    const [sub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, id))
      .limit(1);
    if (sub) publish(toView(sub, updated.runnerStatus));
  }
  return true;
}

export async function reportDone(
  id: string,
  lease: string,
  verdict: Verdict,
  backendVersion: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      problemSlug: submissions.problemSlug,
      maxScore: submissions.maxScore,
    })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  if (!row) return false;

  const [session] = await db
    .update(judgingSessions)
    .set({ lease: null, runnerStatus: null })
    .where(heldBy(id, lease))
    .returning();

  if (!session) return false;

  const [updated] = await db
    .update(submissions)
    .set({
      state: "completed",
      verdict,
      backendVersion,
      ...verdictColumns(
        verdict,
        row.maxScore ?? problemBySlug(row.problemSlug)?.maxScore ?? null,
      ),
      error: null,
      judgedAt: new Date(),
    })
    .where(eq(submissions.id, id))
    .returning();

  if (!updated) return false;

  publish(toView(updated));
  if (updated.contestSlug) invalidateStandings(updated.contestSlug);
  return true;
}

export async function reportFailed(
  id: string,
  lease: string,
  reason: string,
  backendVersion: string,
): Promise<boolean> {
  const [session] = await db
    .update(judgingSessions)
    .set({ lease: null, runnerStatus: null })
    .where(heldBy(id, lease))
    .returning();

  if (!session) return false;

  const [updated] = await db
    .update(submissions)
    .set({
      state: "disrupted",
      backendVersion,
      error: reason,
      judgedAt: new Date(),
    })
    .where(eq(submissions.id, id))
    .returning();

  if (!updated) return false;

  publish(toView(updated));
  return true;
}

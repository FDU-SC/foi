import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { judgingAttempts, judgingQueue, submissions } from "@/lib/db/schema";
import { publish } from "@/lib/submissions/events";
import { HEARTBEAT_LAPSE_MS, MAX_ATTEMPTS, QUEUE_FUSE_MS } from "./queue";

const QUEUE_FUSE_INTERVAL = `${QUEUE_FUSE_MS} milliseconds`;

export async function reapOnce(): Promise<{
  exhausted: number;
  requeued: number;
  fused: number;
}> {
  const lapsedBefore = new Date(Date.now() - HEARTBEAT_LAPSE_MS);

  const lapsedRows = await db
    .select({
      submissionId: judgingQueue.submissionId,
      attempts: judgingQueue.attempts,
      runnerId: judgingQueue.runnerId,
      runnerStatus: judgingQueue.runnerStatus,
    })
    .from(judgingQueue)
    .where(
      and(
        eq(judgingQueue.state, "claimed"),
        lt(judgingQueue.heartbeatAt, lapsedBefore),
      ),
    );

  let exhaustedCount = 0;
  let requeuedCount = 0;

  for (const row of lapsedRows) {
    const isExhausted = row.attempts >= MAX_ATTEMPTS;

    if (isExhausted) {
      await db
        .update(submissions)
        .set({
          state: "disrupted",
          error: `评测机连续 ${MAX_ATTEMPTS} 次领取后都失去了联系，已停止重试`,
          judgedAt: new Date(),
        })
        .where(eq(submissions.id, row.submissionId));

      await db
        .delete(judgingQueue)
        .where(eq(judgingQueue.submissionId, row.submissionId));

      await publish(db, row.submissionId, { state: "disrupted" });
      exhaustedCount++;
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
        .where(eq(judgingQueue.submissionId, row.submissionId));

      await publish(db, row.submissionId, { state: "queued" });
      requeuedCount++;
    }

    if (row.runnerId) {
      await db
        .update(judgingAttempts)
        .set({
          finishedAt: new Date(),
          outcome: "expired",
          lastStatus: row.runnerStatus,
          error: "心跳超时",
        })
        .where(
          and(
            eq(judgingAttempts.submissionId, row.submissionId),
            eq(judgingAttempts.runnerId, row.runnerId),
            eq(judgingAttempts.outcome, sql`null`),
          ),
        );
    }
  }

  // Fuse: queued too long without any runner picking it up
  const fusedRows = await db
    .select({ submissionId: judgingQueue.submissionId })
    .from(judgingQueue)
    .where(
      and(
        eq(judgingQueue.state, "waiting"),
        lt(judgingQueue.queuedAt, sql`now() - ${QUEUE_FUSE_INTERVAL}::interval`),
      ),
    );

  for (const row of fusedRows) {
    await db
      .update(submissions)
      .set({
        state: "disrupted",
        error: `排队超过 ${Math.round(QUEUE_FUSE_MS / 3_600_000)} 小时仍无评测机领取`,
        judgedAt: new Date(),
      })
      .where(eq(submissions.id, row.submissionId));

    await db
      .delete(judgingQueue)
      .where(eq(judgingQueue.submissionId, row.submissionId));

    await publish(db, row.submissionId, { state: "disrupted" });
  }

  // Also mark waiting items that have exhausted attempts
  const stuckRows = await db
    .select({ submissionId: judgingQueue.submissionId })
    .from(judgingQueue)
    .where(
      and(
        eq(judgingQueue.state, "waiting"),
        gte(judgingQueue.attempts, MAX_ATTEMPTS),
      ),
    );

  for (const row of stuckRows) {
    await db
      .update(submissions)
      .set({
        state: "disrupted",
        error: `评测机连续 ${MAX_ATTEMPTS} 次领取后都失去了联系，已停止重试`,
        judgedAt: new Date(),
      })
      .where(eq(submissions.id, row.submissionId));

    await db
      .delete(judgingQueue)
      .where(eq(judgingQueue.submissionId, row.submissionId));

    await publish(db, row.submissionId, { state: "disrupted" });
  }

  return {
    exhausted: exhaustedCount + stuckRows.length,
    requeued: requeuedCount,
    fused: fusedRows.length,
  };
}

declare global {
  var __foiReaperRanAt: number | undefined;
  var __foiReaperStartedAt: number | undefined;
}

function reaperRanAt(): Date | null {
  return globalThis.__foiReaperRanAt
    ? new Date(globalThis.__foiReaperRanAt)
    : null;
}

const REAPER_STALE_MS = 5 * 60 * 1000;

export function reaperHealth(): { ok: boolean; ranAt: Date | null } {
  const ranAt = reaperRanAt();
  const since = ranAt?.getTime() ?? globalThis.__foiReaperStartedAt;

  if (since === undefined) return { ok: true, ranAt: null };

  return { ok: Date.now() - since < REAPER_STALE_MS, ranAt };
}

export async function recentDisruptions(windowMs: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.state, "disrupted"),
        gte(submissions.judgedAt, new Date(Date.now() - windowMs)),
      ),
    );
  return row?.count ?? 0;
}

export function startReaping(intervalMs: number): () => void {
  let timer: NodeJS.Timeout;
  let stopped = false;

  globalThis.__foiReaperStartedAt = Date.now();

  const tick = async () => {
    try {
      const { exhausted, requeued, fused } = await reapOnce();
      if (exhausted || requeued || fused) {
        console.log(
          `[foi] 回收: 重新入队 ${requeued} 条，attempts 用尽 ${exhausted} 条，排队超时 ${fused} 条`,
        );
      }
      globalThis.__foiReaperRanAt = Date.now();
    } catch (error) {
      console.error("[foi] 回收失败", error);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, 0);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { judgingAttempts, judgingQueue, submissions } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { publish } from "@/lib/submissions/events";
import { HEARTBEAT_LAPSE_MS, MAX_ATTEMPTS, QUEUE_FUSE_MS } from "./queue";

const QUEUE_FUSE_INTERVAL = `${QUEUE_FUSE_MS} milliseconds`;

export async function reapOnce(): Promise<{
  exhausted: number;
  requeued: number;
  fused: number;
}> {
  const lapsedBefore = new Date(Date.now() - HEARTBEAT_LAPSE_MS);

  const fused = and(
    eq(judgingQueue.state, "waiting"),
    lt(judgingQueue.queuedAt, sql`now() - ${QUEUE_FUSE_INTERVAL}::interval`),
  )!;
  const eligible = or(
    and(
      eq(judgingQueue.state, "claimed"),
      lt(judgingQueue.heartbeatAt, lapsedBefore),
    ),
    fused,
    and(eq(judgingQueue.state, "waiting"), gte(judgingQueue.attempts, MAX_ATTEMPTS)),
  );
  const candidates = await db
    .select({ submissionId: judgingQueue.submissionId })
    .from(judgingQueue)
    .where(eligible);

  const counts = { exhausted: 0, requeued: 0, fused: 0 };
  for (const candidate of candidates) {
    const outcome = await db.transaction(async (tx) => {
      // Recheck after acquiring the lock: a heartbeat or report may have won.
      const [locked] = await tx
        .select({ row: judgingQueue, fused: sql<boolean>`${fused}` })
        .from(judgingQueue)
        .where(and(eq(judgingQueue.submissionId, candidate.submissionId), eligible))
        .for("update");
      if (!locked) return undefined;

      const { row } = locked;
      const outcome = locked.fused
        ? "fused"
        : row.attempts >= MAX_ATTEMPTS ? "exhausted" : "requeued";
      const now = new Date();
      if (outcome !== "requeued") {
        await tx.update(submissions).set({
          state: "disrupted",
          error: outcome === "fused"
            ? `排队超过 ${Math.round(QUEUE_FUSE_MS / 3_600_000)} 小时仍无评测机领取`
            : `评测机连续 ${MAX_ATTEMPTS} 次领取后都失去了联系，已停止重试`,
          judgedAt: now,
        }).where(eq(submissions.id, row.submissionId));
      }

      if (row.state === "claimed" && row.runnerId && row.claimedAt) {
        await tx.update(judgingAttempts).set({
          finishedAt: now,
          outcome: "expired",
          lastStatus: row.runnerStatus,
          error: "心跳超时",
        }).where(and(
          eq(judgingAttempts.submissionId, row.submissionId),
          eq(judgingAttempts.runnerId, row.runnerId),
          eq(judgingAttempts.claimedAt, row.claimedAt),
          isNull(judgingAttempts.outcome),
        ));
      }

      if (outcome === "requeued") {
        await tx.update(judgingQueue).set({
          state: "waiting",
          runnerId: null,
          lease: null,
          runnerStatus: null,
          heartbeatAt: null,
          claimedAt: null,
          queuedAt: sql`now()`,
        }).where(eq(judgingQueue.submissionId, row.submissionId));
      } else {
        await tx.delete(judgingQueue).where(eq(judgingQueue.submissionId, row.submissionId));
      }
      await publish(tx, row.submissionId, {
        state: outcome === "requeued" ? "queued" : "disrupted",
      });
      return outcome;
    });
    if (outcome) counts[outcome]++;
  }

  return counts;
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
        log.info(
          `回收: 重新入队 ${requeued} 条，attempts 用尽 ${exhausted} 条，排队超时 ${fused} 条`,
        );
      }
      globalThis.__foiReaperRanAt = Date.now();
    } catch (error) {
      log.error("回收失败", error);
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

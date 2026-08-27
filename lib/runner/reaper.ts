import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { HEARTBEAT_LAPSE_MS, MAX_ATTEMPTS, QUEUE_FUSE_MS } from "./queue";

const QUEUE_FUSE_INTERVAL = `${QUEUE_FUSE_MS} milliseconds`;

export async function reapOnce(): Promise<{
  exhausted: number;
  requeued: number;
  fused: number;
}> {
  const lapsedBefore = new Date(Date.now() - HEARTBEAT_LAPSE_MS);

  const exhausted = await db
    .update(submissions)
    .set({
      state: "disrupted",
      lease: null,
      runnerStatus: null,
      error: `评测机连续 ${MAX_ATTEMPTS} 次领取后都失去了联系，已停止重试`,
      judgedAt: new Date(),
    })
    .where(
      and(
        eq(submissions.state, "judging"),
        lt(submissions.lastHeartbeatAt, lapsedBefore),
        gte(submissions.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning();

  const requeued = await db
    .update(submissions)
    .set({
      state: "queued",
      lease: null,
      runnerId: null,
      runnerStatus: null,
      claimedAt: null,
      lastHeartbeatAt: null,

      queuedAt: sql`now()`,
      error: "评测机失去联系，已重新排队",
    })
    .where(
      and(
        eq(submissions.state, "judging"),
        lt(submissions.lastHeartbeatAt, lapsedBefore),
      ),
    )
    .returning();

  const fused = await db
    .update(submissions)
    .set({
      state: "disrupted",
      error: `排队超过 ${Math.round(QUEUE_FUSE_MS / 3_600_000)} 小时仍无评测机领取`,
      judgedAt: new Date(),
    })
    .where(
      and(
        eq(submissions.state, "queued"),
        lt(submissions.queuedAt, sql`now() - ${QUEUE_FUSE_INTERVAL}::interval`),
      ),
    )
    .returning();

  const stuck = await db
    .update(submissions)
    .set({
      state: "disrupted",
      error: `评测机连续 ${MAX_ATTEMPTS} 次领取后都失去了联系，已停止重试`,
      judgedAt: new Date(),
    })
    .where(
      and(
        eq(submissions.state, "queued"),
        gte(submissions.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning();

  for (const row of [...exhausted, ...requeued, ...fused, ...stuck]) {
    publish(toView(row));
  }

  return {
    exhausted: exhausted.length + stuck.length,
    requeued: requeued.length,
    fused: fused.length,
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

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";
import { HEARTBEAT_LAPSE_MS, MAX_ATTEMPTS, QUEUE_FUSE_MS } from "./queue";

/**
 * The only loop, and the only place the kernel concludes anything on its own.
 *
 * It replaces two: a poller that asked every backend what it was holding, and a
 * verifier that reasoned about the difference between that answer and the
 * kernel's own in-flight set. Both existed because the queue lived somewhere
 * else and had to be inferred across a network. It does not any more, so there
 * is nothing to reconcile — every fact this needs is a column, and a pass is
 * four indexed statements that normally affect zero rows.
 *
 * What it decides, in order:
 *
 *   1. a holder went quiet and the row has no attempts left → `disrupted`
 *   2. a holder went quiet → back to `queued`
 *   3. nothing has come for it since it was queued and the fuse has burned
 *      through → `disrupted`
 *   4. nobody is holding it and it has no attempts left → `disrupted`
 *
 * One and two are one condition split by the attempt count, and they run in
 * that order on purpose: writing off first means the requeue statement cannot
 * hand a doomed row back to the pool for one more lap. Four is the same
 * conclusion as one, reached about a row that is sitting in `queued` instead:
 * `claimJob` refuses to hand those out, so no heartbeat will ever lapse on
 * them and nothing else would ever conclude.
 *
 * Three and four read `submissions_queued_idx` without its leading column, so
 * both are a scan of that index rather than a seek — and four filters on
 * `attempts`, which is not in it at all. Deliberately not given an index of its
 * own: the set it scans is the queue, which is small by construction, and the
 * subset it is looking for is a submission that has killed three runners in a
 * row, which in a working deployment is empty and stays empty. A second index
 * would be maintained on every insert and every claim in order to find nothing
 * faster.
 */

/**
 * A pass. Never throws for a row it could not settle — every statement is a
 * `where` clause, so anything that has moved underneath it is simply not
 * matched.
 */
export async function reapOnce(): Promise<{
  exhausted: number;
  requeued: number;
  fused: number;
}> {
  const lapsedBefore = new Date(Date.now() - HEARTBEAT_LAPSE_MS);

  // Written off rather than requeued: this row has been picked up
  // `MAX_ATTEMPTS` times and killed or lost its holder every time. Handing it
  // out again would walk it through the rest of the pool.
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

  // Back in the pool, and the lease dies here. That is what stops the original
  // holder — which may be alive and merely partitioned — from reporting a
  // result on work that now belongs to somebody else.
  //
  // `error` is set rather than cleared so the row explains itself while it
  // waits; `claimJob` clears it on the way back out.
  const requeued = await db
    .update(submissions)
    .set({
      state: "queued",
      lease: null,
      runnerId: null,
      runnerStatus: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      // A fresh lap starts here, and the fuse below measures from it. Leaving
      // this at the creation time is what used to make the next tick write the
      // row off as never claimed, moments after taking it away from the runner
      // that had claimed it.
      queuedAt: new Date(),
      error: "评测机失去联系，已重新排队",
    })
    .where(
      and(
        eq(submissions.state, "judging"),
        lt(submissions.lastHeartbeatAt, lapsedBefore),
      ),
    )
    .returning();

  // The fuse. Nothing is wrong with this row — nobody has come for it since it
  // was put in the queue, which almost always means no runner is being run for
  // its backend at all. Distinguishable from a backlog on the board, where the
  // runner count is beside the queue depth for exactly this reason.
  //
  // Measured from `queued_at`, and it is worth being explicit about why, since
  // `created_at` is the obvious column and was the wrong one. The question is
  // about this lap, not about the submission: a row put back in the queue by the
  // block above, or by an administrator rejudging, starts its wait again. Timed
  // from creation instead, every submission older than the fuse came back into
  // the queue already expired and was written off on the following tick — with
  // an `error` blaming an absent runner, on a row a runner had just been holding.
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
        lt(submissions.queuedAt, new Date(Date.now() - QUEUE_FUSE_MS)),
      ),
    )
    .returning();

  // Rows past the attempt cap that are sitting in `queued` rather than
  // `judging`. `claimJob` refuses to hand these out, so without this they would
  // wait out the fuse before being written off — six hours of a spinner for a
  // submission the kernel already knows it will never resolve. Counted as
  // `exhausted` below rather than reported separately, because it is the same
  // conclusion as the first block reached one tick later, and an operator
  // reading the log is being told how many submissions the kernel gave up on
  // rather than which statement got there first.
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
}

/**
 * When a pass last finished, in this process.
 *
 * Deliberately not a row in the database, and the reasoning has changed since
 * the same question was asked of the old verifier. Back then the objection to a
 * process-local timestamp was that it only works while the loop runs in the web
 * process — true, and the whole point of splitting the poller from the verifier
 * had been to keep moving them out cheap. There is one loop now, it runs in the
 * web process, and both readers of this — `/api/health` and `/admin` — are
 * served by that same process. So a local timestamp answers precisely the
 * question each of them is asking: *is the reaper on the instance you are
 * talking to alive?* A shared row would answer a blurrier one, and would go
 * green for an instance whose own loop had wedged as long as some other
 * instance's had not.
 *
 * The day the reaper moves to a process of its own, this needs a heartbeat
 * table. Until then a table would be machinery for a deployment nobody runs.
 */
function reaperRanAt(): Date | null {
  return globalThis.__foiReaperRanAt
    ? new Date(globalThis.__foiReaperRanAt)
    : null;
}

/**
 * How stale the last pass may be before the loop counts as stopped.
 *
 * Generous against the interval, because one slow pass is not a fault and a
 * check that flaps is one nobody trusts. What it has to catch is a loop that is
 * not running — a crash, or an await with no timeout on the other side of it.
 * Which is also why the answer cannot be "is the process up": a reaper wedged
 * on a call that never returns is running perfectly well and doing nothing.
 */
const REAPER_STALE_MS = 5 * 60 * 1000;

/**
 * Whether the loop looks alive.
 *
 * Worth a check of its own because the failure is silent from every other
 * angle. If this stops, a runner that dies takes its jobs with it — they stay
 * `judging` for good — while the site serves pages, accepts submissions and
 * answers `/api/health` with a reachable database.
 *
 * Null before the first pass, which is a freshly started process rather than a
 * fault; `register` runs one immediately, so the window is a few seconds.
 */
export function reaperHealth(): { ok: boolean; ranAt: Date | null } {
  const ranAt = reaperRanAt();
  if (!ranAt) return { ok: true, ranAt: null };
  return { ok: Date.now() - ranAt.getTime() < REAPER_STALE_MS, ranAt };
}

/**
 * Recently disrupted rows, as a number an operator can watch.
 *
 * The cheapest thing standing in for an internal-error console. DMOJ mails an
 * administrator on every one and DOMjudge makes them first-class objects with a
 * resolved flag; both are more than this deployment needs, and both need
 * columns or integrations that do not exist. What is genuinely bad without any
 * of it is not that a single disruption goes unnoticed — the row says so and an
 * administrator can rejudge it — but that a runner failing *every* job looks
 * exactly like a quiet afternoon. A count over a window separates those two.
 */
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

/**
 * One self-scheduling loop, and the handle that stops it.
 *
 * Self-scheduling rather than `setInterval` so a slow pass cannot overlap
 * itself: the next tick is booked when the previous one finishes. The old
 * reconciler used a fixed timer over a sweep that could outlast its own
 * interval, and ended up with dozens of passes in flight against a backend that
 * had stopped answering.
 *
 * Which is exactly why a timer handle is the wrong thing to hand back, and
 * this used to hand back one: the first `setTimeout`, which by the time anybody
 * could have cleared it had already fired. Each tick booked its successor into
 * a local nobody outside could read, so `instrumentation.ts` cancelling the
 * value it was given cancelled a timer that no longer existed and every hot
 * reload during `next dev` left another loop running against the same tables.
 * Silent, because the extra passes are correct — they simply do the same work
 * several times a second and keep a stopped reaper looking alive.
 *
 * A closure instead, and it carries a flag as well as a `clearTimeout`.
 * Cancelling the pending timer is not enough on its own: a pass may be in
 * flight, and its `finally` would book the next one after the caller believed
 * the loop had stopped.
 */
export function startReaping(intervalMs: number): () => void {
  let timer: NodeJS.Timeout;
  let stopped = false;

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

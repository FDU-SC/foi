import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { accounts, problems, runners, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import { rejudgeSubmissions } from "@/lib/submissions/rejudge";
import {
  claimJob,
  HEARTBEAT_LAPSE_MS,
  MAX_ATTEMPTS,
  QUEUE_FUSE_MS,
  reportAlive,
  reportDone,
  reportFailed,
} from "./queue";
import { reaperHealth, reapOnce, startReaping } from "./reaper";

/**
 * The only loop, and the only place the kernel concludes anything by itself.
 *
 * A pass sweeps the whole table — it is four unscoped `update ... where`
 * statements — so the evidence in every case below is the fixture row's own
 * state rather than the counts `reapOnce` hands back: a shared development
 * database may well hold rows this suite did not write, and an exact count
 * would be asserting something about them.
 */
const HANDLE = "runner-reaper-alice";

/** This suite's own queue, for the reason given in `queue.db.test.ts`. */
const BACKEND = "runner-reaper-fixture";

const PROBLEM = externallyJudged()[0]!;
const VERDICT: Verdict = { status: "accepted", score: 100, maxScore: 100 };
const VERSION = "runner-reaper-fixture/1.0.0";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function enqueue(
  id: string,
  overrides: Partial<typeof submissions.$inferInsert> = {},
): Promise<string> {
  await db.insert(submissions).values({
    id,
    handle: HANDLE,
    problemSlug: PROBLEM.slug,
    payload: {},
    backendId: BACKEND,
    state: "queued",
    ...overrides,
  });
  return id;
}

async function rowOf(id: string): Promise<typeof submissions.$inferSelect> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, id));
  return row;
}

/**
 * Ages a holder's last heartbeat past the lapse window.
 *
 * The column is written rather than the clock moved, because the reaper reads
 * `Date.now()` in the same pass that writes `judged_at` — a faked timer would
 * shift both ends of the comparison and prove nothing.
 */
async function goSilent(id: string): Promise<void> {
  await db
    .update(submissions)
    .set({ lastHeartbeatAt: new Date(Date.now() - HEARTBEAT_LAPSE_MS - 1_000) })
    .where(eq(submissions.id, id));
}

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
  await db.delete(runners).where(eq(runners.backendId, BACKEND));
}

describeDb("失联回收", () => {
  beforeAll(async () => {
    await cleanup();
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
  });

  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  });

  afterAll(cleanup);

  it("心跳过期的行回到队列，lease 一并作废", async () => {
    const id = await enqueue("sub_rr_lapsed");
    await claimJob(BACKEND, "r-gone");
    await goSilent(id);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("queued");
    // Everything describing the holder goes with it. The lease is the load
    // bearing one — nulling it is what stops the original holder, which may be
    // alive and merely partitioned, from reporting on work that is about to
    // belong to somebody else.
    expect(row.lease).toBeNull();
    expect(row.runnerId).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.lastHeartbeatAt).toBeNull();
    expect(row.error).toContain("失去联系");
    // Not reset, which is the only reason the cap means anything: a row that
    // kills whatever picks it up would otherwise cycle for ever at attempt one.
    expect(row.attempts).toBe(1);
  });

  /**
   * The other side of the same condition, and the reason the two statements run
   * in this order: writing off first is what stops the requeue handing an
   * already-doomed row back to the pool for one more lap through every runner.
   */
  it("attempts 用尽的失联行不再入队，直接落 disrupted", async () => {
    const id = await enqueue("sub_rr_exhausted");
    await claimJob(BACKEND, "r-doomed");
    // Two earlier laps, compressed: what matters to the reaper is the count on
    // the row, not how it got there.
    await db
      .update(submissions)
      .set({ attempts: MAX_ATTEMPTS })
      .where(eq(submissions.id, id));
    await goSilent(id);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("disrupted");
    expect(row.lease).toBeNull();
    expect(row.judgedAt).not.toBeNull();
    expect(row.error).toContain(String(MAX_ATTEMPTS));
  });

  /**
   * What `claimJob` leaves behind when it refuses to hand out a capped row: it
   * stays `queued`, held by nobody, and no heartbeat will ever lapse on it. The
   * fuse would eventually catch it six hours later, which is six hours of a
   * spinner for a submission the kernel has already concluded on.
   */
  it("卡在队列里且 attempts 用尽的行也会被写掉，不必等保险丝", async () => {
    const id = await enqueue("sub_rr_stuck", { attempts: MAX_ATTEMPTS });

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("disrupted");
    expect(row.error).toContain(String(MAX_ATTEMPTS));
  });

  /**
   * The negative space, and it needs cases of its own because every recovery
   * case above calls `goSilent` first.
   *
   * Delete `last_heartbeat_at < lapsedBefore` from both of the first two
   * statements — turning the reaper into something that takes every `judging`
   * row away from its holder once per tick — and all of them still pass. The
   * predicate deciding *who* gets reaped is the one thing the suite was not
   * asserting on, and it is the whole difference between a queue that recovers
   * from a dead runner and one that never finishes anything.
   */
  it("心跳还新鲜的行不会被收走，lease 也不动", async () => {
    const id = await enqueue("sub_rr_fresh");
    const ticket = await claimJob(BACKEND, "r-working");
    expect(ticket?.id).toBe(id);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("judging");
    // The lease is the load-bearing one again, from the other side: a reaper
    // that nulls it here has silently fired a runner that was doing its job,
    // and the report it is about to send will be refused.
    expect(row.lease).toBe(ticket?.lease);
    expect(row.runnerId).toBe("r-working");
    expect(row.claimedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.error).toBeNull();
  });

  /**
   * The same row a tick later, once the runner has spoken. This is the only
   * thing `reportAlive` is for, so if the reaper reads anything other than the
   * column that heartbeat writes, a slow-but-healthy evaluation is taken away
   * from its holder no matter how loudly it says otherwise.
   */
  it("失联之后又报了心跳的行，同样不会被收走", async () => {
    const id = await enqueue("sub_rr_revived");
    const ticket = await claimJob(BACKEND, "r-slow");
    await goSilent(id);
    await expect(
      reportAlive(id, ticket!.lease, "测试点 7/10"),
    ).resolves.toBe(true);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("judging");
    expect(row.lease).toBe(ticket?.lease);
    expect(row.runnerStatus).toBe("测试点 7/10");
  });

  /**
   * The last lap, where the predicate matters most. `claimJob` hands out a row
   * sitting at `MAX_ATTEMPTS - 1` and leaves it at the cap, so a runner
   * partway through its third and final attempt matches everything the
   * write-off statement asks for except the lapsed heartbeat — and this row
   * has no fourth attempt to be given.
   */
  it("最后一次尝试正在跑、心跳正常的行不会被直接写掉", async () => {
    const id = await enqueue("sub_rr_last_lap", {
      attempts: MAX_ATTEMPTS - 1,
    });
    const ticket = await claimJob(BACKEND, "r-final");
    expect((await rowOf(id)).attempts).toBe(MAX_ATTEMPTS);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("judging");
    expect(row.lease).toBe(ticket?.lease);
    expect(row.judgedAt).toBeNull();
  });

  /**
   * The sequence a lease exists for, end to end: A goes quiet, the row is taken
   * back and handed to B, and then A wakes up. Checking the runner's identity
   * could not refuse this — A does not stop being A, it stops holding the lease
   * — and neither could a "is this state still writable" predicate, since the
   * row is in exactly the state a report is supposed to land on.
   */
  it("重新入队之后，失联的 runner 拿旧 lease 什么都写不进去", async () => {
    const id = await enqueue("sub_rr_handover");
    const first = await claimJob(BACKEND, "r-a");
    await goSilent(id);
    await reapOnce();

    const second = await claimJob(BACKEND, "r-b");
    expect(second?.id).toBe(id);
    expect(second?.lease).not.toBe(first?.lease);

    // All three, not just the verdict. A stale heartbeat that landed would keep
    // resetting the reaper's clock on a job its sender no longer holds, which
    // is the quietest of the three failures and the hardest to see afterwards.
    await expect(reportAlive(id, first!.lease, "测试点 3/10")).resolves.toBe(
      false,
    );
    await expect(reportDone(id, first!.lease, VERDICT, VERSION)).resolves.toBe(
      false,
    );
    await expect(
      reportFailed(id, first!.lease, "我跑不动", VERSION),
    ).resolves.toBe(false);

    const row = await rowOf(id);
    expect(row.state).toBe("judging");
    expect(row.lease).toBe(second?.lease);
    expect(row.runnerId).toBe("r-b");
    expect(row.runnerStatus).toBeNull();
    expect(row.verdict).toBeNull();
    expect(row.error).toBeNull();

    // And the guard refuses the stale holder rather than everybody: B's own
    // report still lands, or the assertions above would pass on a broken queue.
    await expect(reportDone(id, second!.lease, VERDICT, VERSION)).resolves.toBe(
      true,
    );
    expect((await rowOf(id)).state).toBe("completed");
  });

  /**
   * The fuse, and the column it is timed from.
   *
   * It shipped reading `created_at`, which cannot answer the question it asks.
   * "Has anybody come for this" is about the current lap, and two paths start a
   * new one without creating a row: the requeue above, and a rejudge. Every
   * submission older than the fuse therefore re-entered the queue already
   * expired and was written off — with an `error` blaming an absent runner, on a
   * row that in the requeue case a runner had been holding seconds earlier.
   *
   * Invisible in a healthy deployment, where something claims the row before
   * the next tick; certain when the queue is deep or nothing is online, which is
   * when somebody is most likely to be rejudging in the first place.
   */
  describe("排队保险丝", () => {
    /** Comfortably past the fuse, whatever it is set to. */
    const longAgo = (): Date => new Date(Date.now() - QUEUE_FUSE_MS - 3_600_000);

    /**
     * First, that the fuse fires at all. Without this the two cases below would
     * pass just as well against a fuse that had been deleted, or one pointed at
     * a column nothing ever writes.
     */
    it("从来没人领过的旧行会被烧掉", async () => {
      const id = await enqueue("sub_rr_fuse_burns", {
        createdAt: longAgo(),
        queuedAt: longAgo(),
      });

      await reapOnce();

      const row = await rowOf(id);
      expect(row.state).toBe("disrupted");
      expect(row.error).toContain("无评测机领取");
      expect(row.judgedAt).not.toBeNull();
    });

    it("很旧的提交经重判回到队列，不会被立刻烧掉", async () => {
      const id = await enqueue("sub_rr_fuse_rejudged", {
        createdAt: longAgo(),
        queuedAt: longAgo(),
        state: "disrupted",
        error: "上一轮评测中断",
        judgedAt: longAgo(),
      });
      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      await reapOnce();

      const row = await rowOf(id);
      expect(row.state).toBe("queued");
      expect(row.error).toBeNull();
      // And the row is still as old as it was. Advancing `created_at` would
      // silence the fuse too, and is the fix not taken: it is what a submission
      // list shows and what the contest window is compared against, so a
      // rejudge would move the submission inside the round it was made during.
      expect(row.createdAt.getTime()).toBeLessThan(Date.now() - QUEUE_FUSE_MS);
      expect(row.queuedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    /**
     * The same failure on the path nobody was looking at, and it needs only one
     * pass to show: the requeue and the fuse are consecutive statements inside
     * `reapOnce`, so the row reclaimed by the second was burned by the third
     * before the runner pool ever got a chance to see it again.
     */
    it("很旧的提交经心跳失联重新入队，同一趟也不会被烧掉", async () => {
      const id = await enqueue("sub_rr_fuse_requeued", {
        createdAt: longAgo(),
        queuedAt: longAgo(),
      });
      const ticket = await claimJob(BACKEND, "r-old-and-gone");
      expect(ticket?.id).toBe(id);
      await goSilent(id);

      await reapOnce();

      const row = await rowOf(id);
      expect(row.state).toBe("queued");
      expect(row.error).toContain("失去联系");
      expect(row.judgedAt).toBeNull();
      expect(row.createdAt.getTime()).toBeLessThan(Date.now() - QUEUE_FUSE_MS);
      expect(row.queuedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

      // Still there on the next pass, rather than surviving one tick and being
      // written off on the one after.
      await reapOnce();
      expect((await rowOf(id)).state).toBe("queued");
    });
  });
});

/**
 * The loop's own health signal, which is the one thing here that touches no
 * table.
 *
 * It lives in this file rather than a `reaper.test.ts` of its own because
 * `reaper.ts` imports `lib/db`, and that module throws on import without a
 * connection string — a unit-project test would take the whole DB-less run
 * down with it. Ungated for the same reason the rest of the file is gated: by
 * the time anything here executes, the import has already succeeded.
 */
describe("回收循环的存活信号", () => {
  /** Longer than any plausible staleness window, and shorter than none. */
  const AN_HOUR = 60 * 60_000;

  const forget = () => {
    globalThis.__foiReaperRanAt = undefined;
    globalThis.__foiReaperStartedAt = undefined;
  };

  beforeEach(() => {
    forget();
    // Before `startReaping`, so the tick it books at zero never fires: this
    // suite is about what the signal reports, not about what a pass does, and
    // a real pass would write the success timestamp the cases below withhold.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    forget();
  });

  it("没有循环被启动过时不报故障", () => {
    expect(reaperHealth()).toEqual({ ok: true, ranAt: null });
  });

  it("刚启动、还没跑完一趟时是绿的", () => {
    const stop = startReaping(15_000);
    try {
      expect(reaperHealth()).toEqual({ ok: true, ranAt: null });
    } finally {
      stop();
    }
  });

  /**
   * The failure this signal exists for, and the one it used to be blind to.
   *
   * `tick` writes the success timestamp only after `reapOnce` returns, so a
   * loop whose every pass throws never writes one — and "no timestamp" was
   * read as "freshly started". `/api/health` therefore answered
   * `reaper: "up"` for the lifetime of a process whose reaper had never once
   * completed a pass, which is precisely the silent fault it is watching for.
   */
  it("从来没有一趟跑成功过时，过了 stale 窗口就要报停摆", () => {
    const stop = startReaping(15_000);
    try {
      vi.setSystemTime(Date.now() + AN_HOUR);

      const health = reaperHealth();
      expect(health.ok).toBe(false);
      // Still null, and it has to stay null: the two readers of this print
      // "本进程还没有跑过一轮" from it, which is the difference between a loop
      // that stopped and a loop that never started working.
      expect(health.ranAt).toBeNull();
    } finally {
      stop();
    }
  });

  it("跑成功过之后，判据换成最后一次成功的时间", () => {
    const stop = startReaping(15_000);
    try {
      // Long enough that the start time alone would already read as stalled.
      vi.setSystemTime(Date.now() + AN_HOUR);
      const ranAt = Date.now();
      globalThis.__foiReaperRanAt = ranAt;

      expect(reaperHealth()).toEqual({ ok: true, ranAt: new Date(ranAt) });

      // And it goes stale in its turn, or the fallback above would have been
      // bought by making the check unable to fail.
      vi.setSystemTime(Date.now() + AN_HOUR);
      expect(reaperHealth()).toEqual({ ok: false, ranAt: new Date(ranAt) });
    } finally {
      stop();
    }
  });
});

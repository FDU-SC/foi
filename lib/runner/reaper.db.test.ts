import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { reapOnce } from "./reaper";

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

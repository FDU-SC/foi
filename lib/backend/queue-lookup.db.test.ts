import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import { MAX_ATTEMPTS } from "@/lib/runner/queue";
import { locateInQueues, locateOne } from "./queue-lookup";

/**
 * Where a submission sits in its backend's queue.
 *
 * Exact is the entire claim, and it is what holding the queue here bought over
 * matching against whatever a backend last reported about itself. So these
 * cases are about the two ways a count can be exactly wrong: taking the
 * ordering from the column that says when somebody submitted rather than when
 * they joined the queue, and counting rows no runner will ever be handed. Both
 * misreport somebody else's wait, and a position that does not fall the way the
 * queue drains is read as a stuck queue.
 *
 * Against a real Postgres because the answer is two statements against the same
 * set `claimJob` selects from, and the point of the assertions is that the two
 * agree.
 */
const HANDLE = "queue-lookup-alice";

/** This suite's own queue — `lib/runner/queue.db.test.ts` says why. */
const BACKEND = "queue-lookup-fixture";

const PROBLEM = externallyJudged()[0]!;

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

const ago = (ms: number): Date => new Date(Date.now() - ms);

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
}

describeDb("排队位次", () => {
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

  it("数的是同一个后端队列里排在前面的行", async () => {
    const first = await enqueue("sub_ql_first", { queuedAt: ago(90_000) });
    const third = await enqueue("sub_ql_third", { queuedAt: ago(30_000) });
    await enqueue("sub_ql_second", { queuedAt: ago(60_000) });

    const found = await locateInQueues([first, third]);

    expect(found.get(first)).toMatchObject({ backendId: BACKEND, ahead: 0 });
    expect(found.get(third)).toMatchObject({ state: "queued", ahead: 2 });
  });

  /**
   * The same disagreement `claimJob` orders on. A requeued submission keeps its
   * original `created_at` and takes a fresh `queued_at`, so counting by the
   * former put it at the head of a queue it had just joined — and told everyone
   * it actually landed behind that there was one fewer ahead of them.
   */
  it("按进队列的时间数，而不是按提交的时间", async () => {
    await enqueue("sub_ql_fresh", {
      createdAt: ago(60_000),
      queuedAt: ago(60_000),
    });
    const requeued = await enqueue("sub_ql_requeued", {
      createdAt: ago(7 * 86_400_000),
      queuedAt: ago(30_000),
    });

    await expect(locateOne(requeued)).resolves.toMatchObject({ ahead: 1 });
  });

  /**
   * Rows at the attempt cap are deliberately left `queued` for the reaper to
   * write off rather than disrupted from inside `claimJob`, so for up to one
   * tick the table holds work nobody will ever be offered. Counting it promised
   * the person behind it a wait that was not there.
   */
  it("attempts 用尽的行不算在前面——claimJob 本来也不会把它发出去", async () => {
    await enqueue("sub_ql_doomed", {
      queuedAt: ago(90_000),
      attempts: MAX_ATTEMPTS,
    });
    const behind = await enqueue("sub_ql_behind", { queuedAt: ago(30_000) });

    await expect(locateOne(behind)).resolves.toMatchObject({ ahead: 0 });
  });

  it("已经被领走的行位次是 0，不管前面还排着谁", async () => {
    await enqueue("sub_ql_waiting", { queuedAt: ago(90_000) });
    const held = await enqueue("sub_ql_held", {
      queuedAt: ago(60_000),
      state: "judging",
      lease: "lease-ql",
      runnerId: "r-ql",
      claimedAt: new Date(),
      lastHeartbeatAt: new Date(),
      attempts: 1,
    });

    await expect(locateOne(held)).resolves.toMatchObject({
      state: "judging",
      ahead: 0,
    });
  });

  it("终态的提交根本不在队列里，问出来是 null 而不是 0", async () => {
    const done = await enqueue("sub_ql_done", {
      state: "completed",
      outcome: "accepted",
      judgedAt: new Date(),
    });

    await expect(locateOne(done)).resolves.toBeNull();
  });
});

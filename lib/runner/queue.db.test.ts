import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import {
  accounts,
  contests,
  problems,
  runners,
  submissions,
} from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import { scoredSubmissions } from "@/lib/standings/types";
import { rejudgeSubmissions } from "@/lib/submissions/rejudge";
import {
  claimJob,
  jobDetails,
  MAX_ATTEMPTS,
  reportDone,
  reportFailed,
} from "./queue";

/**
 * The queue, against a real Postgres, because every guarantee in it is the
 * database's rather than the code's.
 *
 * `for update skip locked` handing one row to exactly one runner, and a lease
 * compared inside the `where` clause of every write, are properties of
 * statements. A test with a mocked driver could only assert that this module
 * calls the API it calls, which is the tautology these cases exist to avoid.
 */
const HANDLE = "runner-queue-alice";
const CONTEST = "runner-queue-round";

/**
 * A queue belonging to this suite alone.
 *
 * `claimJob` selects on the backend column and nothing else — it is an opaque
 * queue selector, never resolved against `content/backends.ts`, see the note on
 * `backendId` in `lib/db/schema.ts`. A fixture value is therefore what keeps
 * the concurrency case exact: under a real backend id the counts below would
 * include whatever else happened to be queued in a development database, and a
 * claim here would take somebody's actual submission out of it.
 */
const BACKEND = "runner-queue-fixture";

/**
 * A problem as authored, so the config handed to a runner is the one somebody
 * wrote rather than a fixture's null. Which backend it names does not matter —
 * what routes a submission is the column above.
 */
const PROBLEM = externallyJudged()[0]!;

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };
const VERDICT: Verdict = { status: "accepted", score: 100, maxScore: 100 };

/**
 * What the rejudge cases report, and it has to be a failing one: `includeAccepted`
 * defaults to off — DOMjudge's default, copied deliberately — so a passing
 * submission is the one shape a plain rejudge declines to touch, and these cases
 * are about what happens after a row goes back in the queue rather than about
 * which rows do.
 */
const WRONG: Verdict = { status: "wrong_answer", score: 0, maxScore: 100 };
const VERSION = "runner-queue-fixture/1.0.0";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

/** One submission waiting to be handed out. */
async function enqueue(
  id: string,
  overrides: Partial<typeof submissions.$inferInsert> = {},
): Promise<string> {
  await db.insert(submissions).values({
    id,
    handle: HANDLE,
    problemSlug: PROBLEM.slug,
    payload: PAYLOAD,
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

async function cleanup(): Promise<void> {
  await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  await db.delete(accounts).where(eq(accounts.handle, HANDLE));
  await db.delete(contests).where(eq(contests.slug, CONTEST));
  await db.delete(runners).where(eq(runners.backendId, BACKEND));
}

describeDb("runner 领活与上报", () => {
  beforeAll(async () => {
    await cleanup();
    // The problem row is the foreign key anchor and is shared with every other
    // suite that submits, so it is created if missing and never removed.
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
    await db.insert(contests).values({ slug: CONTEST, title: "Runner Fixture" });
  });

  // An empty queue at the start of every case. `claimJob` takes the row that
  // has been queued longest on the backend, so a leftover from the case before
  // would be handed out instead of the row the case is about.
  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  });

  afterAll(cleanup);

  describe("领活", () => {
    /**
     * The case the whole locking clause exists for. Serial claims would pass
     * with `skip locked` deleted — even with the `for update` deleted — so the
     * requests have to genuinely overlap.
     */
    it("多个 runner 同时领活时，一条提交只会发给一个人", async () => {
      const ids = ["sub_rq_race_1", "sub_rq_race_2", "sub_rq_race_3"];
      const base = Date.now() - 60_000;
      for (const [index, id] of ids.entries()) {
        await enqueue(id, { queuedAt: new Date(base + index * 1000) });
      }

      const tickets = await Promise.all(
        ["r-1", "r-2", "r-3", "r-4", "r-5"].map((runnerId) =>
          claimJob(BACKEND, runnerId),
        ),
      );
      const handed = tickets.filter((ticket) => ticket !== null);

      // Every row goes out once, and the two runners left over are told there
      // is nothing rather than being sent after a job somebody else is running.
      expect(handed.map((ticket) => ticket.id).sort()).toEqual([...ids].sort());

      const rows = await db
        .select()
        .from(submissions)
        .where(inArray(submissions.id, ids));

      for (const row of rows) {
        expect(row.state).toBe("judging");
        // A row handed to two runners would have been claimed twice, and the
        // count is what the attempt cap is later spent against.
        expect(row.attempts).toBe(1);
      }

      // The lease on the row is the one its holder walked away with. Issuing a
      // second lease for the same row is the quiet half of a double delivery:
      // the loser evaluates the submission in full and then finds it cannot
      // write, having taken a runner out of the pool for the whole run.
      const leaseById = new Map(rows.map((row) => [row.id, row.lease]));
      for (const ticket of handed) {
        expect(ticket.lease).toBe(leaseById.get(ticket.id));
      }
    });

    /**
     * The column the ordering is taken from, which is not the obvious one.
     *
     * `created_at` was, and it was wrong for the two paths that put a row back
     * in `queued` without creating it — the reaper reclaiming a job from a
     * holder that went quiet, and an administrator rejudging. Both deliberately
     * leave `created_at` alone (see `queuedAt` in `lib/db/schema.ts`), so work
     * that had already been judged once arrived at the *head* of the queue,
     * ahead of everything submitted since. A batch rejudge during a round was
     * therefore enough to stall everybody still competing.
     */
    it("按进队列的时间发活，而不是按提交的时间", async () => {
      const requeued = await enqueue("sub_rq_order_requeued", {
        createdAt: new Date(Date.now() - 7 * 86_400_000),
        queuedAt: new Date(Date.now() - 30_000),
      });
      const fresh = await enqueue("sub_rq_order_fresh", {
        createdAt: new Date(Date.now() - 60_000),
        queuedAt: new Date(Date.now() - 60_000),
      });

      // A week older by `created_at`, and still second, because it joined the
      // queue half a minute ago.
      expect((await claimJob(BACKEND, "r-first"))?.id).toBe(fresh);
      expect((await claimJob(BACKEND, "r-second"))?.id).toBe(requeued);
    });

    /**
     * The poison-submission guard, from the claim side. The reaper is what
     * writes these off — covered in `reaper.db.test.ts`; all that is asked here
     * is that one more runner is not sent after it in the meantime.
     */
    it("attempts 已经用尽的行不再发出去", async () => {
      await enqueue("sub_rq_capped", { attempts: MAX_ATTEMPTS });

      await expect(claimJob(BACKEND, "r-capped")).resolves.toBeNull();

      const row = await rowOf("sub_rq_capped");
      expect(row.state).toBe("queued");
      expect(row.attempts).toBe(MAX_ATTEMPTS);
    });
  });

  describe("取详情", () => {
    it("当前持有者拿得到评测所需的一切", async () => {
      await enqueue("sub_rq_details");
      const ticket = await claimJob(BACKEND, "r-details");

      const details = await jobDetails(ticket!.id, ticket!.lease);

      expect(details?.payload).toEqual(PAYLOAD);
      expect(details?.problem).toEqual({
        slug: PROBLEM.slug,
        config: PROBLEM.backend.config,
      });
      expect(details?.user.handle).toBe(HANDLE);
    });

    it("lease 不对就读不到内容，哪怕提交确实存在", async () => {
      await enqueue("sub_rq_wronglease");
      await claimJob(BACKEND, "r-holder");

      await expect(
        jobDetails("sub_rq_wronglease", "not-the-issued-lease"),
      ).resolves.toBeNull();
    });

    /**
     * The exposure the pull model created and this endpoint closes. Under the
     * push model the kernel chose what to send and to whom; now a runner names
     * the id, so one compromised evaluator holding a legitimate lease could
     * otherwise walk the id space — they are time-ordered ULIDs — and read
     * every competitor's source.
     */
    it("拿自己的 lease 换别人那一条的 id，什么也读不到", async () => {
      // Ordered explicitly, because which of the two each runner is handed is
      // decided by `queued_at` and `now()` twice in a row is not a guarantee.
      const mine = await enqueue("sub_rq_mine", {
        queuedAt: new Date(Date.now() - 60_000),
      });
      const theirs = await enqueue("sub_rq_theirs", {
        queuedAt: new Date(Date.now() - 30_000),
      });

      const first = await claimJob(BACKEND, "r-mine");
      const second = await claimJob(BACKEND, "r-theirs");
      expect(first?.id).toBe(mine);
      expect(second?.id).toBe(theirs);

      await expect(jobDetails(theirs, first!.lease)).resolves.toBeNull();
    });
  });

  describe("重判之后的旧 lease", () => {
    /**
     * A retry of a delivery that already landed, arriving after an
     * administrator asked for the row to be judged again. The lease was nulled
     * when the first report settled the row, and `state = 'judging'` inside the
     * guard is the second line: a result may only land on a row that is being
     * judged, so the verdict this carries cannot roll the row back out of the
     * queue it was deliberately put into.
     */
    it("行被放回队列后，上一轮的结果写不回 completed", async () => {
      const id = await enqueue("sub_rq_rejudged");
      const first = await claimJob(BACKEND, "r-first");
      await expect(reportDone(id, first!.lease, WRONG, VERSION)).resolves.toBe(
        true,
      );

      const rejudge = await rejudgeSubmissions([id]);
      expect(rejudge.requeued).toBe(1);

      await expect(reportDone(id, first!.lease, WRONG, VERSION)).resolves.toBe(
        false,
      );

      const row = await rowOf(id);
      expect(row.state).toBe("queued");
      expect(row.verdict).toBeNull();
      expect(row.outcome).toBeNull();
      expect(row.score).toBeNull();
    });

    it("重判后换人领走，旧 lease 也覆盖不掉新持有者", async () => {
      const id = await enqueue("sub_rq_reclaimed");
      const first = await claimJob(BACKEND, "r-first");
      await reportDone(id, first!.lease, WRONG, VERSION);
      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      const second = await claimJob(BACKEND, "r-second");
      expect(second?.id).toBe(id);
      expect(second?.lease).not.toBe(first?.lease);

      await expect(
        reportDone(id, first!.lease, VERDICT, VERSION),
      ).resolves.toBe(false);

      const row = await rowOf(id);
      expect(row.state).toBe("judging");
      expect(row.lease).toBe(second?.lease);
      expect(row.runnerId).toBe("r-second");
      expect(row.verdict).toBeNull();
    });
  });

  describe("runner 报 failed", () => {
    it("落 disrupted，带着原因，而不是一个零分的 verdict", async () => {
      const id = await enqueue("sub_rq_failed");
      const ticket = await claimJob(BACKEND, "r-broken");

      await expect(
        reportFailed(id, ticket!.lease, "沙箱起不来", VERSION),
      ).resolves.toBe(true);

      const row = await rowOf(id);
      expect(row.state).toBe("disrupted");
      expect(row.error).toBe("沙箱起不来");
      expect(row.backendVersion).toBe(VERSION);
      // No result, and specifically not a zero: the whole reason the protocol
      // has no way to report a `system_error` verdict is that a machine fault
      // must not be recorded as something the submitter scored.
      expect(row.verdict).toBeNull();
      expect(row.outcome).toBeNull();
      expect(row.score).toBeNull();
      expect(row.accepted).toBeNull();
      // Nobody holds it any more; the row is settled.
      expect(row.lease).toBeNull();
      expect(row.judgedAt).not.toBeNull();
    });

    /**
     * The bug that stopped existing when the state did. `system_error` used to
     * arrive as a verdict on a `completed` row, which put it on the board and
     * — under ACM — charged the submitter penalty time for a judge falling
     * over. Nothing scores it now because it never reaches `completed`, and
     * this reads the rows back out of the database and through the real filter
     * rather than trusting that.
     */
    it("不进榜：scoredSubmissions 只收 completed 的那一条", async () => {
      const settled = await enqueue("sub_rq_scored", {
        contestSlug: CONTEST,
        createdAt: new Date(Date.now() - 60_000),
        queuedAt: new Date(Date.now() - 60_000),
      });
      const broken = await enqueue("sub_rq_unscored", {
        contestSlug: CONTEST,
        createdAt: new Date(Date.now() - 30_000),
        queuedAt: new Date(Date.now() - 30_000),
      });

      const first = await claimJob(BACKEND, "r-a");
      const second = await claimJob(BACKEND, "r-b");
      expect(first?.id).toBe(settled);
      expect(second?.id).toBe(broken);

      await reportDone(settled, first!.lease, VERDICT, VERSION);
      await reportFailed(broken, second!.lease, "评测机崩了", VERSION);

      // The same projection `lib/standings/compute.ts` reads, so what the
      // ruleset would be handed is what is asserted on.
      const rows = await db
        .select({
          id: submissions.id,
          handle: submissions.handle,
          problemSlug: submissions.problemSlug,
          state: submissions.state,
          verdict: submissions.verdict,
          score: submissions.score,
          maxScore: submissions.maxScore,
          accepted: submissions.accepted,
          createdAt: submissions.createdAt,
        })
        .from(submissions)
        .where(eq(submissions.contestSlug, CONTEST));
      expect(rows.length).toBe(2);

      const scored = scoredSubmissions({
        config: null,
        contest: {
          slug: CONTEST,
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          freezeAt: null,
        },
        problems: [],
        participants: [],
        submissions: rows,
      });

      expect(scored.map((row) => row.id)).toEqual([settled]);
    });
  });
});

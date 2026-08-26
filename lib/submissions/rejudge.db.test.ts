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
import { INLINE_BACKEND_ID, type Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import { claimJob, reportDone } from "@/lib/runner/queue";
import { rejudgeSubmissions } from "./rejudge";

/**
 * Rejudging, and above all the one column it deliberately does not clear.
 *
 * `rejudgeSubmissions` wipes the whole of the last judging — verdict, score,
 * accepted, outcome, backendVersion, error, judgedAt — refreshes `release_sha`
 * to whatever is about to do the judging, and keeps `max_score`. It keeps that
 * one by *not writing it*, which is the shape an invariant takes when it is
 * easiest to lose: adding one more line to that `set` object reads as tidying
 * up, and until now nothing would have gone red.
 *
 * What it costs only shows up one step later, which is why the assertion has
 * to reach that far. `reportDone` resolves the denominator as "the row's own
 * column, then the registry, then null", so clearing the column silently
 * promotes the registry — and the submission is rescored out of whatever total
 * the problem has been edited to since. Retuning a problem and then rejudging
 * a round would restate old submissions against a number nobody competed
 * under.
 *
 * The two refusals are here for a related reason: each is a `return` with
 * nothing to show for it but a count, and each exists to stop an operator's
 * click looking like it worked and then doing nothing for six hours.
 */

const HANDLE = "rejudge-alice";

/**
 * A queue belonging to this suite alone, for the reason spelled out in
 * `lib/runner/queue.db.test.ts`: the column is an opaque selector rather than a
 * lookup into `content/backends.ts`, so a fixture value keeps `claimJob` from
 * reaching into whatever else a development database happens to have queued.
 */
const BACKEND = "rejudge-fixture";

/** A problem as authored, so `stillDispatched` finds it and says yes. */
const PROBLEM = externallyJudged()[0]!;

/**
 * A problem that exists as a row and not in the registry — a definition
 * deleted from `content/` while submissions to it remained. The foreign key
 * protects the mirror row rather than the source, which is exactly how this
 * state arises in production.
 */
const RETIRED = "rejudge-retired-fixture";

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };
const VERSION = "rejudge-fixture/1.0.0";

/**
 * What the submission was scored out of when it was made. Deliberately a total
 * no problem in `content/` declares, because the whole question below is which
 * of the two numbers wins when the row and the registry disagree — and a test
 * cannot edit `content/`, so the disagreement is created from the row's side.
 * It is the same disagreement a configuration edit produces, seen at the only
 * point that reads both.
 */
const OLD_MAX_SCORE = 250;

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

/** One finished submission, as the last judging left it. */
async function settled(
  id: string,
  overrides: Partial<typeof submissions.$inferInsert> = {},
): Promise<string> {
  await db.insert(submissions).values({
    id,
    handle: HANDLE,
    problemSlug: PROBLEM.slug,
    payload: PAYLOAD,
    backendId: BACKEND,
    state: "completed",
    verdict: { status: "wrong_answer", score: 40, maxScore: OLD_MAX_SCORE },
    outcome: "wrong_answer",
    score: 40,
    maxScore: OLD_MAX_SCORE,
    accepted: false,
    backendVersion: VERSION,
    error: "上一轮的抱怨",
    runnerId: "r-previous",
    runnerStatus: "测试点 7/10",
    attempts: 2,
    judgedAt: new Date(),
    claimedAt: new Date(),
    lastHeartbeatAt: new Date(),
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

describeDb("重判", () => {
  beforeAll(async () => {
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    // Shared with every other suite that submits, so created if missing and
    // never removed.
    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(problems)
      .values({ slug: RETIRED, title: "已从 content/ 删掉的题" })
      .onConflictDoNothing();
    await db
      .insert(accounts)
      .values({ handle: HANDLE, displayName: HANDLE, source: "registration" });
  });

  // An empty queue at the start of every case: `claimJob` takes whatever has
  // been waiting longest on this backend, so a leftover would be handed out
  // instead of the row the case is about.
  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
  });

  afterAll(async () => {
    await db.delete(submissions).where(eq(submissions.handle, HANDLE));
    await db.delete(accounts).where(eq(accounts.handle, HANDLE));
    await db.delete(problems).where(eq(problems.slug, RETIRED));
  });

  describe("保留 max_score", () => {
    it("上一轮判定整个清掉，独独留下 max_score", async () => {
      const id = await settled("sub_rj_cleared");

      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      const row = await rowOf(id);
      expect(row.state).toBe("queued");
      expect(row.verdict).toBeNull();
      expect(row.score).toBeNull();
      expect(row.accepted).toBeNull();
      expect(row.outcome).toBeNull();
      expect(row.backendVersion).toBeNull();
      expect(row.error).toBeNull();
      expect(row.judgedAt).toBeNull();
      expect(row.lease).toBeNull();
      expect(row.runnerId).toBeNull();
      expect(row.runnerStatus).toBeNull();
      // A fresh budget and a fresh wait, and `created_at` left where it is.
      expect(row.attempts).toBe(0);

      // The exemption. Everything above says "there is no judging here any
      // more"; this says "and it was still out of 250".
      expect(row.maxScore).toBe(OLD_MAX_SCORE);
    });

    /**
     * The step that gives the exemption its effect, and the only place the two
     * candidate denominators are ever compared. `verdictColumns` takes the
     * fallback from its caller, and `reportDone` is the caller that decided the
     * row outranks the registry.
     */
    it("重判后落定，分母还是行上那个，不是题目现在配置的满分", async () => {
      // The premise: the two numbers genuinely disagree, so the assertion below
      // cannot pass by them happening to be equal.
      expect(PROBLEM.maxScore).not.toBe(OLD_MAX_SCORE);

      const id = await settled("sub_rj_denominator");
      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      const ticket = await claimJob(BACKEND, "r-again");
      expect(ticket?.id).toBe(id);

      // A verdict naming no total of its own, which is the case the fallback
      // exists for — a backend that reports a raw score and leaves the
      // denominator to the platform.
      const verdict: Verdict = { status: "wrong_answer", score: 30 };
      await expect(
        reportDone(id, ticket!.lease, verdict, VERSION),
      ).resolves.toBe(true);

      const row = await rowOf(id);
      expect(row.state).toBe("completed");
      expect(row.score).toBe(30);
      expect(row.maxScore).toBe(OLD_MAX_SCORE);
    });

    /**
     * And the other direction, so the fallback is not mistaken for a ceiling:
     * a backend that does name a total still owns the answer, because that is
     * a statement about the judging that just ran rather than about the row's
     * history.
     */
    it("后端自己报了分母，就用后端报的那个", async () => {
      const id = await settled("sub_rj_backend_denominator");
      await rejudgeSubmissions([id]);

      const ticket = await claimJob(BACKEND, "r-declares");
      const verdict: Verdict = {
        status: "accepted",
        score: 60,
        maxScore: 60,
        accepted: true,
      };
      await reportDone(id, ticket!.lease, verdict, VERSION);

      expect((await rowOf(id)).maxScore).toBe(60);
    });
  });

  /**
   * The other pair on the row, and the one that moves where `max_score` stays.
   *
   * `release_sha` and `backend_version` together are what make a verdict
   * reproducible, and a rejudge changes exactly one end of it. The problem
   * definition the backend evaluates against is read out of the live registry
   * by `jobDetails` when the runner fetches details — not snapshotted at submit
   * time — so after a rejudge it is *this* release's. Keeping the original
   * value would pair a freshly reported `backend_version` with a `release_sha`
   * naming a tree that had nothing to do with the judging.
   *
   * The contrast with `max_score` is the point. That column is kept because it
   * records what the competitor was scored out of, which a rejudge must not
   * restate; these two record who did the judging, which a rejudge does change.
   */
  describe("刷新 release_sha", () => {
    const OLD_SHA = "0000000000000000000000000000000000000000";
    const NEW_SHA = "1111111111111111111111111111111111111111";

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("重判后记的是当前这份构建，而不是提交那次的", async () => {
      const id = await settled("sub_rj_sha", { releaseSha: OLD_SHA });
      vi.stubEnv("FOI_RELEASE_SHA", NEW_SHA);

      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      const row = await rowOf(id);
      expect(row.releaseSha).toBe(NEW_SHA);
      // Its other half waits for the runner to say so; only this one is
      // knowable at the moment the work is handed back out.
      expect(row.backendVersion).toBeNull();
    });

    /**
     * A hand-built image did not come from a commit, and a rejudge run on one
     * has to say so rather than leave the previous release standing — that
     * value would then describe a judging performed by something else.
     */
    it("非 CI 构建上重判，写的是 null 而不是留着旧值", async () => {
      const id = await settled("sub_rj_sha_unknown", { releaseSha: OLD_SHA });
      vi.stubEnv("FOI_RELEASE_SHA", undefined);

      await rejudgeSubmissions([id]);

      expect((await rowOf(id)).releaseSha).toBeNull();
    });
  });

  describe("拒绝重判的两种行", () => {
    /**
     * Nothing signs as `inline`, so no runner can ever claim one of these.
     * Requeuing it would leave it spinning until the queue fuse burned through
     * six hours later, for an operator who thought they had done something.
     */
    it("内联判出来的行不进队列，只报一个计数", async () => {
      const id = await settled("sub_rj_inline", {
        backendId: INLINE_BACKEND_ID,
      });

      const result = await rejudgeSubmissions([id]);
      expect(result).toMatchObject({ requeued: 0, skippedInline: 1 });

      const row = await rowOf(id);
      expect(row.state).toBe("completed");
      expect(row.verdict).not.toBeNull();
    });

    /**
     * The same conclusion reached from the other end. The queue named on the
     * row is real and has runners on it, and they would take the job happily —
     * but `jobDetails` resolves the problem through the registry and would
     * answer each of them with `config: null`. Three attempts get spent
     * arriving back where the operator started, and the row lands in
     * `disrupted` blaming a runner that did nothing wrong.
     */
    it("题目已经不外派的行不进队列，只报一个计数", async () => {
      const id = await settled("sub_rj_stranded", { problemSlug: RETIRED });

      const result = await rejudgeSubmissions([id]);
      expect(result).toMatchObject({
        requeued: 0,
        skippedNotDispatched: 1,
      });

      const row = await rowOf(id);
      expect(row.state).toBe("completed");
      expect(row.verdict).not.toBeNull();

      // And nothing was put on the fixture queue for a runner to find.
      await expect(claimJob(BACKEND, "r-nothing")).resolves.toBeNull();
    });
  });
});

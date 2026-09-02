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
import { accounts, contests, judgingQueue, problems, submissions } from "@/lib/db/schema";
import { externallyJudged } from "@/lib/problems/registry";
import { claimJob, reportDone } from "@/lib/runner/queue";
import { rejudgeSubmissions } from "./rejudge";

const USERNAME = "rejudge-alice";
let ACCOUNT_UID = 0;

const BACKEND = "rejudge-fixture";

const PROBLEM = externallyJudged()[0]!;

const RETIRED = "rejudge-retired-fixture";

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };
const VERSION = "rejudge-fixture/1.0.0";

const CONTEST = "rejudge-round";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function settled(
  id: string,
  overrides: Partial<typeof submissions.$inferInsert> = {},
): Promise<string> {
  await db.insert(submissions).values({
    id,
    uid: ACCOUNT_UID,
    problemSlug: PROBLEM.slug,
    contestSlug: CONTEST,
    payload: PAYLOAD,
    backendId: BACKEND,
    state: "completed",
    result: { status: "wrong_answer", score: 40, maxScore: 250, accepted: false },
    detail: null,
    backendVersion: VERSION,
    error: "上一轮的抱怨",
    judgedAt: new Date(),
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
    await db.delete(accounts).where(eq(accounts.username, USERNAME));

    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    await db
      .insert(contests)
      .values({ slug: CONTEST, title: "Rejudge Fixture" })
      .onConflictDoNothing();
    await db
      .insert(problems)
      .values({ slug: RETIRED, title: "已从 content/ 删掉的题" })
      .onConflictDoNothing();
    const [acct] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: USERNAME })
      .returning({ uid: accounts.uid });
    ACCOUNT_UID = acct.uid;
  });

  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
  });

  afterAll(async () => {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
    await db.delete(accounts).where(eq(accounts.uid, ACCOUNT_UID));
    await db.delete(problems).where(eq(problems.slug, RETIRED));
    await db.delete(contests).where(eq(contests.slug, CONTEST));
  });

  describe("重判清空判定结果", () => {
    it("上一轮判定整个清掉", async () => {
      const id = await settled("sub_rj_cleared");

      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      const row = await rowOf(id);
      expect(row.state).toBe("pending");
      expect(row.result).toBeNull();
      expect(row.detail).toBeNull();
      expect(row.backendVersion).toBeNull();
      expect(row.error).toBeNull();
      expect(row.judgedAt).toBeNull();

      const [q] = await db
        .select()
        .from(judgingQueue)
        .where(eq(judgingQueue.submissionId, id));
      expect(q.attempts).toBe(0);
    });

    it("重判后落定，result 来自后端本次上报", async () => {
      const id = await settled("sub_rj_denominator");
      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      const ticket = await claimJob(BACKEND, "r-again");
      expect(ticket?.id).toBe(id);

      const verdict: Verdict = { result: { status: "wrong_answer", score: 30, maxScore: 100 } };
      await expect(
        reportDone(id, ticket!.lease, verdict, VERSION),
      ).resolves.toBe(true);

      const row = await rowOf(id);
      expect(row.state).toBe("completed");
      expect(row.result).toEqual({ status: "wrong_answer", score: 30, maxScore: 100 });
    });

    it("后端上报的 result 原样落库", async () => {
      const id = await settled("sub_rj_backend_denominator");
      await rejudgeSubmissions([id]);

      const ticket = await claimJob(BACKEND, "r-declares");
      const verdict: Verdict = {
        result: { status: "accepted", score: 60, maxScore: 60, accepted: true },
      };
      await reportDone(id, ticket!.lease, verdict, VERSION);

      const row = await rowOf(id);
      expect(row.result).toEqual({ status: "accepted", score: 60, maxScore: 60, accepted: true });
    });
  });

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

      expect(row.backendVersion).toBeNull();
    });

    it("非 CI 构建上重判，写的是 null 而不是留着旧值", async () => {
      const id = await settled("sub_rj_sha_unknown", { releaseSha: OLD_SHA });
      vi.stubEnv("FOI_RELEASE_SHA", undefined);

      await rejudgeSubmissions([id]);

      expect((await rowOf(id)).releaseSha).toBeNull();
    });
  });

  describe("拒绝重判的两种行", () => {

    it("内联判出来的行不进队列，只报一个计数", async () => {
      const id = await settled("sub_rj_inline", {
        backendId: INLINE_BACKEND_ID,
      });

      const result = await rejudgeSubmissions([id]);
      expect(result).toMatchObject({ requeued: 0, skippedInline: 1 });

      const row = await rowOf(id);
      expect(row.state).toBe("completed");
      expect(row.result).not.toBeNull();
    });

    it("题目已经不外派的行不进队列，只报一个计数", async () => {
      const id = await settled("sub_rj_stranded", { problemSlug: RETIRED });

      const result = await rejudgeSubmissions([id]);
      expect(result).toMatchObject({
        requeued: 0,
        skippedNotDispatched: 1,
      });

      const row = await rowOf(id);
      expect(row.state).toBe("completed");
      expect(row.result).not.toBeNull();

      await expect(claimJob(BACKEND, "r-nothing")).resolves.toBeNull();
    });
  });
});

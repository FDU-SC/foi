import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Verdict } from "@/lib/backend/types";
import { db } from "@/lib/db";
import {
  accounts,
  contests,
  judgingAttempts,
  judgingQueue,
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

const USERNAME = "runner-queue-alice";
let ACCOUNT_UID = 0;
const CONTEST = "runner-queue-round";

const BACKEND = "runner-queue-fixture";

const PROBLEM = externallyJudged()[0]!;

const PAYLOAD = { language: "cpp", source: "int main() { return 0; }" };
const VERDICT: Verdict = { result: { status: "accepted", score: 100, maxScore: 100 } };

const WRONG: Verdict = { result: { status: "wrong_answer", score: 0, maxScore: 100 } };
const VERSION = "runner-queue-fixture/1.0.0";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function enqueue(
  id: string,
  overrides: {
    contestSlug?: string;
    createdAt?: Date;
    queuedAt?: Date;
    attempts?: number;
  } = {},
): Promise<string> {
  await db.insert(submissions).values({
    id,
    uid: ACCOUNT_UID,
    problemSlug: PROBLEM.slug,
    payload: PAYLOAD,
    backendId: BACKEND,
    state: "pending",
    contestSlug: overrides.contestSlug ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  });
  await db.insert(judgingQueue).values({
    submissionId: id,
    backendId: BACKEND,
    state: "waiting",
    queuedAt: overrides.queuedAt ?? new Date(),
    attempts: overrides.attempts ?? 0,
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

async function queueOf(id: string): Promise<typeof judgingQueue.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(judgingQueue)
    .where(eq(judgingQueue.submissionId, id));
  return row;
}

async function cleanup(): Promise<void> {
  const [existing] = await db.select({ uid: accounts.uid }).from(accounts).where(eq(accounts.username, USERNAME));
  if (existing) {
    await db.delete(submissions).where(eq(submissions.uid, existing.uid));
    await db.delete(accounts).where(eq(accounts.uid, existing.uid));
  }
  await db.delete(contests).where(eq(contests.slug, CONTEST));
  await db.delete(runners).where(eq(runners.backendId, BACKEND));
}

describeDb("runner 领活与上报", () => {
  beforeAll(async () => {
    await cleanup();

    await db
      .insert(problems)
      .values({ slug: PROBLEM.slug, title: PROBLEM.title })
      .onConflictDoNothing();
    const [acct] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: USERNAME })
      .returning({ uid: accounts.uid });
    ACCOUNT_UID = acct.uid;
    await db.insert(contests).values({ slug: CONTEST, title: "Runner Fixture" });
  });

  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
  });

  afterAll(cleanup);

  describe("领活", () => {

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

      expect(handed.map((ticket) => ticket.id).sort()).toEqual([...ids].sort());

      for (const id of ids) {
        const q = await queueOf(id);
        expect(q?.state).toBe("claimed");
        expect(q?.attempts).toBe(1);
      }

      for (const ticket of handed) {
        const q = await queueOf(ticket.id);
        expect(ticket.lease).toBe(q?.lease);
      }
    });

    it("按进队列的时间发活，而不是按提交的时间", async () => {
      const requeued = await enqueue("sub_rq_order_requeued", {
        createdAt: new Date(Date.now() - 7 * 86_400_000),
        queuedAt: new Date(Date.now() - 30_000),
      });
      const fresh = await enqueue("sub_rq_order_fresh", {
        createdAt: new Date(Date.now() - 60_000),
        queuedAt: new Date(Date.now() - 60_000),
      });

      expect((await claimJob(BACKEND, "r-first"))?.id).toBe(fresh);
      expect((await claimJob(BACKEND, "r-second"))?.id).toBe(requeued);
    });

    it("attempts 已经用尽的行不再发出去", async () => {
      await enqueue("sub_rq_capped", { attempts: MAX_ATTEMPTS });

      await expect(claimJob(BACKEND, "r-capped")).resolves.toBeNull();

      const q = await queueOf("sub_rq_capped");
      expect(q?.state).toBe("waiting");
      expect(q?.attempts).toBe(MAX_ATTEMPTS);
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
      expect(details?.user.uid).toBe(ACCOUNT_UID);
    });

    it("lease 不对就读不到内容，哪怕提交确实存在", async () => {
      await enqueue("sub_rq_wronglease");
      await claimJob(BACKEND, "r-holder");

      await expect(
        jobDetails("sub_rq_wronglease", "not-the-issued-lease"),
      ).resolves.toBeNull();
    });

    it("拿自己的 lease 换别人那一条的 id，什么也读不到", async () => {

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
      expect(row.state).toBe("pending");
      expect(row.result).toBeNull();
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
      expect(row.state).toBe("pending");
      expect(row.result).toBeNull();

      const q = await queueOf(id);
      expect(q?.lease).toBe(second?.lease);
      expect(q?.runnerId).toBe("r-second");
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

      expect(row.result).toBeNull();

      expect(row.judgedAt).not.toBeNull();
    });

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

      const rows = await db
        .select({
          id: submissions.id,
          uid: submissions.uid,
          problemSlug: submissions.problemSlug,
          state: submissions.state,
          result: submissions.result,
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

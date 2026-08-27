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
import {
  accounts,
  judgingAttempts,
  judgingQueue,
  problems,
  runners,
  submissions,
} from "@/lib/db/schema";
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

const USERNAME = "runner-reaper-alice";
let ACCOUNT_UID = 0;

const BACKEND = "runner-reaper-fixture";

const PROBLEM = externallyJudged()[0]!;
const VERDICT: Verdict = { status: "accepted", score: 100, maxScore: 100 };
const VERSION = "runner-reaper-fixture/1.0.0";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function enqueue(
  id: string,
  overrides: {
    sub?: Partial<typeof submissions.$inferInsert>;
    queue?: Partial<typeof judgingQueue.$inferInsert>;
  } = {},
): Promise<string> {
  await db.insert(submissions).values({
    id,
    uid: ACCOUNT_UID,
    problemSlug: PROBLEM.slug,
    payload: {},
    backendId: BACKEND,
    state: "pending",
    ...overrides.sub,
  });
  await db.insert(judgingQueue).values({
    submissionId: id,
    backendId: BACKEND,
    state: "waiting",
    attempts: 0,
    queuedAt: new Date(),
    ...overrides.queue,
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

async function queueRowOf(
  id: string,
): Promise<(typeof judgingQueue.$inferSelect) | undefined> {
  const [row] = await db
    .select()
    .from(judgingQueue)
    .where(eq(judgingQueue.submissionId, id));
  return row;
}

async function goSilent(id: string): Promise<void> {
  await db
    .update(judgingQueue)
    .set({ heartbeatAt: new Date(Date.now() - HEARTBEAT_LAPSE_MS - 1_000) })
    .where(eq(judgingQueue.submissionId, id));
}

async function cleanup(): Promise<void> {
  if (ACCOUNT_UID) {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
    await db.delete(accounts).where(eq(accounts.uid, ACCOUNT_UID));
  }
  await db.delete(runners).where(eq(runners.backendId, BACKEND));
}

describeDb("失联回收", () => {
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
  });

  beforeEach(async () => {
    await db.delete(submissions).where(eq(submissions.uid, ACCOUNT_UID));
  });

  afterAll(cleanup);

  it("心跳过期的行回到队列，lease 一并作废", async () => {
    const id = await enqueue("sub_rr_lapsed");
    await claimJob(BACKEND, "r-gone");
    await goSilent(id);

    await reapOnce();

    const qRow = await queueRowOf(id);
    expect(qRow).toBeDefined();
    expect(qRow!.state).toBe("waiting");

    const row = await rowOf(id);
    expect(row.state).toBe("pending");

    const [attempt] = await db
      .select()
      .from(judgingAttempts)
      .where(eq(judgingAttempts.submissionId, id));
    expect(attempt.outcome).toBe("expired");
    expect(attempt.error).toContain("心跳超时");

    expect(qRow!.attempts).toBe(1);
  });

  it("attempts 用尽的失联行不再入队，直接落 disrupted", async () => {
    const id = await enqueue("sub_rr_exhausted");
    await claimJob(BACKEND, "r-doomed");

    await db
      .update(judgingQueue)
      .set({ attempts: MAX_ATTEMPTS })
      .where(eq(judgingQueue.submissionId, id));
    await goSilent(id);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("disrupted");
    expect(row.judgedAt).not.toBeNull();
    expect(row.error).toContain(String(MAX_ATTEMPTS));

    const qRow = await queueRowOf(id);
    expect(qRow).toBeUndefined();
  });

  it("卡在队列里且 attempts 用尽的行也会被写掉，不必等保险丝", async () => {
    const id = await enqueue("sub_rr_stuck", {
      queue: { attempts: MAX_ATTEMPTS },
    });

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("disrupted");
    expect(row.error).toContain(String(MAX_ATTEMPTS));

    const qRow = await queueRowOf(id);
    expect(qRow).toBeUndefined();
  });

  it("心跳还新鲜的行不会被收走，lease 也不动", async () => {
    const id = await enqueue("sub_rr_fresh");
    const ticket = await claimJob(BACKEND, "r-working");
    expect(ticket?.id).toBe(id);

    await reapOnce();

    const qRow = await queueRowOf(id);
    expect(qRow).toBeDefined();
    expect(qRow!.state).toBe("claimed");
    expect(qRow!.attempts).toBe(1);
    expect(qRow!.lease).toBe(ticket?.lease);
    expect(qRow!.runnerId).toBe("r-working");
    expect(qRow!.claimedAt).not.toBeNull();

    const row = await rowOf(id);
    expect(row.state).toBe("pending");
    expect(row.error).toBeNull();
  });

  it("失联之后又报了心跳的行，同样不会被收走", async () => {
    const id = await enqueue("sub_rr_revived");
    const ticket = await claimJob(BACKEND, "r-slow");
    await goSilent(id);
    await expect(
      reportAlive(id, ticket!.lease, "测试点 7/10"),
    ).resolves.toBe(true);

    await reapOnce();

    const qRow = await queueRowOf(id);
    expect(qRow).toBeDefined();
    expect(qRow!.state).toBe("claimed");
    expect(qRow!.lease).toBe(ticket?.lease);
    expect(qRow!.runnerStatus).toBe("测试点 7/10");

    const row = await rowOf(id);
    expect(row.state).toBe("pending");
  });

  it("最后一次尝试正在跑、心跳正常的行不会被直接写掉", async () => {
    const id = await enqueue("sub_rr_last_lap", {
      queue: { attempts: MAX_ATTEMPTS - 1 },
    });
    const ticket = await claimJob(BACKEND, "r-final");
    expect((await queueRowOf(id))!.attempts).toBe(MAX_ATTEMPTS);

    await reapOnce();

    const qRow = await queueRowOf(id);
    expect(qRow).toBeDefined();
    expect(qRow!.state).toBe("claimed");
    expect(qRow!.lease).toBe(ticket?.lease);

    const row = await rowOf(id);
    expect(row.state).toBe("pending");
    expect(row.judgedAt).toBeNull();
  });

  it("重新入队之后，失联的 runner 拿旧 lease 什么都写不进去", async () => {
    const id = await enqueue("sub_rr_handover");
    const first = await claimJob(BACKEND, "r-a");
    await goSilent(id);
    await reapOnce();

    const second = await claimJob(BACKEND, "r-b");
    expect(second?.id).toBe(id);
    expect(second?.lease).not.toBe(first?.lease);

    await expect(reportAlive(id, first!.lease, "测试点 3/10")).resolves.toBe(
      false,
    );
    await expect(reportDone(id, first!.lease, VERDICT, VERSION)).resolves.toBe(
      false,
    );
    await expect(
      reportFailed(id, first!.lease, "我跑不动", VERSION),
    ).resolves.toBe(false);

    const qRow = await queueRowOf(id);
    expect(qRow).toBeDefined();
    expect(qRow!.state).toBe("claimed");
    expect(qRow!.lease).toBe(second?.lease);
    expect(qRow!.runnerId).toBe("r-b");
    expect(qRow!.runnerStatus).toBeNull();

    const row = await rowOf(id);
    expect(row.state).toBe("pending");
    expect(row.verdict).toBeNull();
    expect(row.error).toBeNull();

    await expect(reportDone(id, second!.lease, VERDICT, VERSION)).resolves.toBe(
      true,
    );
    expect((await rowOf(id)).state).toBe("completed");
  });

  describe("排队保险丝", () => {

    const longAgo = (): Date => new Date(Date.now() - QUEUE_FUSE_MS - 3_600_000);

    it("从来没人领过的旧行会被烧掉", async () => {
      const id = await enqueue("sub_rr_fuse_burns", {
        sub: { createdAt: longAgo() },
        queue: { queuedAt: longAgo() },
      });

      await reapOnce();

      const row = await rowOf(id);
      expect(row.state).toBe("disrupted");
      expect(row.error).toContain("无评测机领取");
      expect(row.judgedAt).not.toBeNull();

      const qRow = await queueRowOf(id);
      expect(qRow).toBeUndefined();
    });

    it("很旧的提交经重判回到队列，不会被立刻烧掉", async () => {
      const id = await enqueue("sub_rr_fuse_rejudged", {
        sub: {
          createdAt: longAgo(),
          state: "disrupted",
          error: "上一轮评测中断",
          judgedAt: longAgo(),
        },
        queue: { queuedAt: longAgo() },
      });

      // Delete from judgingQueue so rejudge can re-insert
      await db.delete(judgingQueue).where(eq(judgingQueue.submissionId, id));
      expect((await rejudgeSubmissions([id])).requeued).toBe(1);

      await reapOnce();

      const qRow = await queueRowOf(id);
      expect(qRow).toBeDefined();
      expect(qRow!.state).toBe("waiting");

      const row = await rowOf(id);
      expect(row.state).toBe("pending");
      expect(row.error).toBeNull();

      expect(row.createdAt.getTime()).toBeLessThan(Date.now() - QUEUE_FUSE_MS);
      expect(qRow!.queuedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it("很旧的提交经心跳失联重新入队，同一趟也不会被烧掉", async () => {
      const id = await enqueue("sub_rr_fuse_requeued", {
        sub: { createdAt: longAgo() },
        queue: { queuedAt: longAgo() },
      });
      const ticket = await claimJob(BACKEND, "r-old-and-gone");
      expect(ticket?.id).toBe(id);
      await goSilent(id);

      await reapOnce();

      const qRow = await queueRowOf(id);
      expect(qRow).toBeDefined();
      expect(qRow!.state).toBe("waiting");

      const row = await rowOf(id);
      expect(row.state).toBe("pending");
      expect(row.judgedAt).toBeNull();
      expect(row.createdAt.getTime()).toBeLessThan(Date.now() - QUEUE_FUSE_MS);
      expect(qRow!.queuedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

      await reapOnce();
      const qRow2 = await queueRowOf(id);
      expect(qRow2).toBeDefined();
      expect(qRow2!.state).toBe("waiting");
    });
  });
});

describe("回收循环的存活信号", () => {

  const AN_HOUR = 60 * 60_000;

  const forget = () => {
    globalThis.__foiReaperRanAt = undefined;
    globalThis.__foiReaperStartedAt = undefined;
  };

  beforeEach(() => {
    forget();

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

  it("从来没有一趟跑成功过时，过了 stale 窗口就要报停摆", () => {
    const stop = startReaping(15_000);
    try {
      vi.setSystemTime(Date.now() + AN_HOUR);

      const health = reaperHealth();
      expect(health.ok).toBe(false);

      expect(health.ranAt).toBeNull();
    } finally {
      stop();
    }
  });

  it("跑成功过之后，判据换成最后一次成功的时间", () => {
    const stop = startReaping(15_000);
    try {

      vi.setSystemTime(Date.now() + AN_HOUR);
      const ranAt = Date.now();
      globalThis.__foiReaperRanAt = ranAt;

      expect(reaperHealth()).toEqual({ ok: true, ranAt: new Date(ranAt) });

      vi.setSystemTime(Date.now() + AN_HOUR);
      expect(reaperHealth()).toEqual({ ok: false, ranAt: new Date(ranAt) });
    } finally {
      stop();
    }
  });
});

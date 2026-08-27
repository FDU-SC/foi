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

const HANDLE = "runner-reaper-alice";

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

    expect(row.lease).toBeNull();
    expect(row.runnerId).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.lastHeartbeatAt).toBeNull();
    expect(row.error).toContain("失去联系");

    expect(row.attempts).toBe(1);
  });

  it("attempts 用尽的失联行不再入队，直接落 disrupted", async () => {
    const id = await enqueue("sub_rr_exhausted");
    await claimJob(BACKEND, "r-doomed");

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

  it("卡在队列里且 attempts 用尽的行也会被写掉，不必等保险丝", async () => {
    const id = await enqueue("sub_rr_stuck", { attempts: MAX_ATTEMPTS });

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("disrupted");
    expect(row.error).toContain(String(MAX_ATTEMPTS));
  });

  it("心跳还新鲜的行不会被收走，lease 也不动", async () => {
    const id = await enqueue("sub_rr_fresh");
    const ticket = await claimJob(BACKEND, "r-working");
    expect(ticket?.id).toBe(id);

    await reapOnce();

    const row = await rowOf(id);
    expect(row.state).toBe("judging");

    expect(row.lease).toBe(ticket?.lease);
    expect(row.runnerId).toBe("r-working");
    expect(row.claimedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
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

    const row = await rowOf(id);
    expect(row.state).toBe("judging");
    expect(row.lease).toBe(ticket?.lease);
    expect(row.runnerStatus).toBe("测试点 7/10");
  });

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

    const row = await rowOf(id);
    expect(row.state).toBe("judging");
    expect(row.lease).toBe(second?.lease);
    expect(row.runnerId).toBe("r-b");
    expect(row.runnerStatus).toBeNull();
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

      expect(row.createdAt.getTime()).toBeLessThan(Date.now() - QUEUE_FUSE_MS);
      expect(row.queuedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

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

      await reapOnce();
      expect((await rowOf(id)).state).toBe("queued");
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

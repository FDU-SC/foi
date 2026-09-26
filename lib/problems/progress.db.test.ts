import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { contestProblemRefs } from "@/lib/contests/refs";
import { pairKey } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { accounts, submissions } from "@/lib/db/schema";
import { viewerWith } from "@/test/content-shapes";
import { progressFor } from "./progress";
import { viewsFor } from "./views";

const refs = contestProblemRefs();
const pair = refs.find((ref) => viewsFor(ref.problem.slug).progress && refs.some((other) =>
  other.problem.slug === ref.problem.slug && other.contest.slug !== ref.contest.slug))!;
const other = refs.find((ref) => ref.problem.slug === pair.problem.slug && ref.contest.slug !== pair.contest.slug)!;
const here = pairKey(pair.contest.slug, pair.problem.slug);
const there = pairKey(other.contest.slug, other.problem.slug);
const uids: number[] = [];
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb("个人进度读取", () => {
  beforeAll(async () => {
    await ensureContest(pair.contest);
    await ensureContest(other.contest);
    await ensureProblem(pair.problem);
    const users = await db.insert(accounts).values([
      { username: "progress-owner", nickname: "owner" },
      { username: "progress-peer", nickname: "peer" },
    ]).returning({ uid: accounts.uid });
    uids.push(...users.map(({ uid }) => uid));
    const base = { uid: uids[0], problemSlug: pair.problem.slug, contestSlug: pair.contest.slug, payload: {}, backendId: "progress", state: "completed" as const };
    await db.insert(submissions).values([
      { ...base, id: "progress-old-pass", result: 7, createdAt: new Date(0) },
      { ...base, id: "progress-other-user", uid: uids[1], result: 999, createdAt: new Date(1) },
      { ...base, id: "progress-other-contest", contestSlug: other.contest.slug, result: 888, createdAt: new Date(2) },
    ]);
    for (let start = 0; start < 5001; start += 500) {
      await db.insert(submissions).values(Array.from({ length: Math.min(500, 5001 - start) }, (_, index) => ({
        ...base, id: `progress-later-${start + index}`, result: 0, createdAt: new Date(100 + start + index),
      })));
    }
  });
  afterAll(async () => {
    if (!uids.length) return;
    await db.delete(submissions).where(inArray(submissions.uid, uids));
    await db.delete(accounts).where(inArray(accounts.uid, uids));
  });
  it("可读所有人的用户仍只聚合自己的当前比赛完整历史", async () => {
    const views = viewsFor(pair.problem.slug);
    const interpret = vi.spyOn(views, "progress");
    try {
      const result = await progressFor([pair.contest.slug], viewerWith("submission.read", uids[0]));
      expect(result.get(here)?.state).toBe("solved");
      const history = interpret.mock.calls[0][0];
      expect(history).toHaveLength(5002);
      expect(history[0].result).toBe(7);
      expect(history.every((row) => row.result === 7 || row.result === 0)).toBe(true);
      expect(history[0]).not.toHaveProperty("payload");
      expect(history[0]).not.toHaveProperty("detail");
      const second = await progressFor([other.contest.slug], viewerWith("submission.read", uids[0]));
      expect(second.get(there)?.state).toBe("attempted");
      const both = await progressFor([pair.contest.slug, other.contest.slug], viewerWith("submission.read", uids[0]));
      expect(both.get(here)?.state).toBe("solved");
      expect(both.get(there)?.state).toBe("attempted");
    } finally { interpret.mockRestore(); }
  });
  it("游客无进度，未配置解释的题目不返回进度", async () => {
    const views = viewsFor(pair.problem.slug);
    const original = views.progress;
    try {
      expect(await progressFor([pair.contest.slug], ANONYMOUS)).toEqual(new Map());
      // Other supported problems may still have history; this one must be omitted.
      delete views.progress;
      expect((await progressFor([pair.contest.slug], viewerWith("submission.read", uids[0]))).has(here)).toBe(false);
    } finally { views.progress = original; }
  });
  it("重判清除结果后重新计算", async () => {
    await db.update(submissions).set({ state: "pending", result: null }).where(eq(submissions.id, "progress-old-pass"));
    expect((await progressFor([pair.contest.slug], viewerWith("submission.read", uids[0]))).get(here)?.state).toBe("attempted");
  });
});

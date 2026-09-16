import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { accounts, contests, problems, submissions } from "@/lib/db/schema";
import { contestConfigSchema, type ContestConfig } from "@/lib/contests/types";
import { problemConfigSchema } from "@/lib/problems/types";
import { leaderboardRows } from "./leaderboard-data";

const state = vi.hoisted(() => ({ contests: new Map<string, ContestConfig>(), listed: [] as string[] }));
vi.mock("@/lib/contests/catalogue", () => ({ catalogueSlugs: () => state.listed }));
vi.mock("@/lib/contests/registry", () => ({
  contestBySlug: (slug: string) => state.contests.get(slug),
  allContests: () => [...state.contests.values()],
}));
// Exercise the real authorization engine against these content-defined pairs.
vi.mock("@/lib/contests/refs", () => ({
  contestProblemRefs: () => [],
  contestProblemRefsIn: (slug: string) => {
    const contest = state.contests.get(slug);
    return contest?.problems.map((entry) => ({ contest, entry,
      problem: problemConfigSchema.parse({ slug: entry.slug, title: entry.slug, backend: { id: "test" } }),
    })) ?? [];
  },
}));
const NOW = new Date("2030-01-01T01:00:00Z");
const at = (minute: number) => new Date(+NOW - 3600000 + minute * 60000);
const slugs = ["practice-test-a", "practice-test-b", "practice-test-private", "practice-test-sealed", "practice-test-off"];
const problemSlugs = ["practice-test-p", "practice-test-q"];
const uids: number[] = [];
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("练习排行榜数据库聚合", () => {
  beforeAll(async () => {
    for (const slug of slugs) {
      state.contests.set(slug, contestConfigSchema.parse({
        slug, title: slug, startsAt: at(0).toISOString(), endsAt: at(30).toISOString(),
        afterEnd: { submissions: true },
        problems: problemSlugs.map((slug) => ({ slug })),
        leaderboards: [{ id: "main", title: "test", ruleset: { id: "test" } }],
      }));
    }
    state.contests.get(slugs[2])!.visibleTo = [];
    state.contests.get(slugs[3])!.afterEnd = { statements: false, submissions: false };
    state.listed = slugs.slice(0, 4);
    await db.insert(contests).values(slugs.map((slug) => ({ slug, title: slug })));
    await db.insert(problems).values(problemSlugs.map((slug) => ({ slug, title: slug })));
    const users = await db.insert(accounts).values(["a", "b", "c", "d", "e"].map((key) => ({ username: `practice-test-${key}`, nickname: key }))).returning({ uid: accounts.uid });
    uids.push(...users.map(({ uid }) => uid));
    const row = (id: string, user: number, problem: number, minute: number, result: unknown = { accepted: true }, contest = slugs[0], status: "completed" | "pending" | "disrupted" = "completed") => ({
      id: `practice-test-${id}`, uid: uids[user], problemSlug: problemSlugs[problem], contestSlug: contest,
      payload: {}, backendId: "test", state: status, result, createdAt: at(minute), judgedAt: at(59 - minute / 2),
    });
    await db.insert(submissions).values([
      row("a-p", 0, 0, 1), row("a-p-again", 0, 0, 2, { accepted: true }, slugs[1]),
      row("a-q", 0, 1, 40), // after-end practice; reaches two later than b
      row("b-p", 1, 0, 3), row("b-q", 1, 1, 4),
      row("c-fail", 2, 0, 5, { accepted: "true" }), row("d-fail", 3, 0, 6, false),
      row("e-earliest", 4, 0, 0),
      row("prestart", 2, 1, -1), row("future", 2, 1, 61),
      row("private", 2, 1, 7, { accepted: true }, slugs[2]),
      row("sealed", 2, 1, 7, { accepted: true }, slugs[3]),
      row("unlisted", 2, 1, 7, { accepted: true }, slugs[4]),
      row("pending", 2, 1, 8, { accepted: true }, slugs[0], "pending"),
      row("disrupted", 2, 1, 9, { accepted: true }, slugs[0], "disrupted"),
    ]);
    await db.update(accounts).set({ status: "suspended" }).where(eq(accounts.uid, uids[4]));
  });
  afterAll(async () => {
    if (uids.length) {
      await db.delete(submissions).where(inArray(submissions.uid, uids));
      await db.delete(accounts).where(inArray(accounts.uid, uids));
    }
    await db.delete(contests).where(inArray(contests.slug, slugs));
    await db.delete(problems).where(inArray(problems.slug, problemSlugs));
  });
  it("按题去重并按达成时间排序，只统计公开、已完成和 active 账号", async () => {
    const rows = await leaderboardRows(50, NOW);
    expect(rows.map(({ uid, solved, submissions, firstBloods }) => ({ uid, solved, submissions, firstBloods }))).toEqual([
      { uid: uids[1], solved: 2, submissions: 2, firstBloods: 1 },
      { uid: uids[0], solved: 2, submissions: 3, firstBloods: 1 },
      { uid: uids[2], solved: 0, submissions: 1, firstBloods: 0 },
      { uid: uids[3], solved: 0, submissions: 1, firstBloods: 0 },
    ]);
    expect(await leaderboardRows(1, NOW)).toEqual(rows.slice(0, 1));
  });
  it("封榜退出、解封恢复，退役题目和移除题库也即时生效", async () => {
    const contest = state.contests.get(slugs[0])!;
    const endsAt = contest.endsAt;
    const entries = contest.problems;
    try {
      contest.endsAt = at(90);
      contest.freezeAt = at(50);
      const frozen = await leaderboardRows(50, NOW);
      expect(frozen).toHaveLength(1);
      expect(frozen[0]).toMatchObject({ uid: uids[0], solved: 1, submissions: 1 });
      expect(await leaderboardRows(50, at(91))).toHaveLength(4);
      contest.endsAt = endsAt;
      delete contest.freezeAt;
      contest.problems = entries.filter(({ slug }) => slug !== problemSlugs[1]);
      expect((await leaderboardRows(50, NOW))[0]).toMatchObject({ uid: uids[0], solved: 1 });
      state.listed = [];
      expect(await leaderboardRows(50, NOW)).toEqual([]);
    } finally { contest.endsAt = endsAt; delete contest.freezeAt; contest.problems = entries; state.listed = slugs.slice(0, 4); }
  });
  it("封禁与重判令首杀顺延，解封恢复", async () => {
    await db.update(accounts).set({ status: "active" }).where(eq(accounts.uid, uids[4]));
    expect((await leaderboardRows(50, NOW)).find(({ uid }) => uid === uids[4])?.firstBloods).toBe(1);
    await db.update(accounts).set({ status: "suspended" }).where(eq(accounts.uid, uids[4]));
    await db.update(submissions).set({ result: { accepted: false } }).where(eq(submissions.id, "practice-test-a-p"));
    expect((await leaderboardRows(50, NOW)).find(({ uid }) => uid === uids[0])?.firstBloods).toBe(1);
    await db.update(submissions).set({ result: null, state: "pending" }).where(eq(submissions.id, "practice-test-a-p-again"));
    expect((await leaderboardRows(50, NOW))[0]).toMatchObject({ uid: uids[1], firstBloods: 2 });
  });
  it("达成时间相同以 uid 排序，首杀时间相同以提交 id 排序", async () => {
    await db.update(submissions).set({ result: { accepted: true }, state: "completed", createdAt: at(3) })
      .where(inArray(submissions.id, ["practice-test-a-p", "practice-test-b-p"]));
    await db.update(submissions).set({ createdAt: at(4) }).where(eq(submissions.id, "practice-test-a-q"));
    const rows = await leaderboardRows(50, NOW);
    expect(rows.slice(0, 2).map(({ uid }) => uid)).toEqual(uids.slice(0, 2));
    expect(rows[0].firstBloods).toBe(2);
  });
});

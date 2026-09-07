import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts, contests, problems, submissions } from "@/lib/db/schema";
import { leaderboardRows } from "./stats";

const CONTEST = "stats-leaderboard-fixture";
const PROBLEMS = ["stats-leaderboard-a", "stats-leaderboard-b"];
const USERNAMES = {
  alice: "stats-leaderboard-alice",
  bob: "stats-leaderboard-bob",
  carol: "stats-leaderboard-carol",
  dave: "stats-leaderboard-dave",
} as const;
const USERS = [
  { username: USERNAMES.alice, nickname: "Alice" },
  { username: USERNAMES.bob, nickname: "Bob" },
  { username: USERNAMES.carol, nickname: "Carol" },
  { username: USERNAMES.dave, nickname: "Dave" },
];

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function cleanup(): Promise<void> {
  const existing = await db
    .select({ uid: accounts.uid })
    .from(accounts)
    .where(
      inArray(
        accounts.username,
        USERS.map(({ username }) => username),
      ),
    );

  if (existing.length > 0) {
    const uids = existing.map(({ uid }) => uid);
    await db.delete(submissions).where(inArray(submissions.uid, uids));
    await db.delete(accounts).where(inArray(accounts.uid, uids));
  }

  await db.delete(problems).where(inArray(problems.slug, PROBLEMS));
  await db.delete(contests).where(inArray(contests.slug, [CONTEST]));
}

describeDb("全局排行榜数据库统计", () => {
  const uids = new Map<string, number>();

  beforeAll(async () => {
    await cleanup();

    await db.insert(contests).values({ slug: CONTEST, title: "Stats Fixture" });
    await db.insert(problems).values(
      PROBLEMS.map((slug) => ({ slug, title: slug })),
    );

    const inserted = await db
      .insert(accounts)
      .values(USERS)
      .returning({ uid: accounts.uid, username: accounts.username });

    for (const account of inserted) {
      uids.set(account.username, account.uid);
    }

    const submission = (
      id: string,
      username: string,
      problem: 0 | 1,
      accepted: boolean,
      createdAt: number,
      judgedAt: number | null,
    ) => ({
      id,
      uid: uids.get(username)!,
      problemSlug: PROBLEMS[problem],
      contestSlug: CONTEST,
      payload: {},
      backendId: "stats-fixture",
      state: "completed" as const,
      result: { accepted },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, createdAt)),
      judgedAt:
        judgedAt === null
          ? null
          : new Date(Date.UTC(2026, 0, 1, 0, judgedAt)),
    });

    await db.insert(submissions).values([
      submission("sub_stats_alice_a_ac", USERNAMES.alice, 0, true, 0, 10),
      submission("sub_stats_alice_b_wa", USERNAMES.alice, 1, false, 1, 2),
      submission("sub_stats_bob_a_ac", USERNAMES.bob, 0, true, 2, 9),
      submission("sub_stats_bob_a_again", USERNAMES.bob, 0, true, 3, 11),
      submission("sub_stats_bob_b_ac", USERNAMES.bob, 1, true, 4, null),
      submission("sub_stats_carol_a_wa", USERNAMES.carol, 0, false, 5, 6),
      submission("sub_stats_carol_b_ac", USERNAMES.carol, 1, true, 6, 8),
    ]);
  });

  afterAll(cleanup);

  it("汇总并排序参赛者，以评测时间选出每题首杀", async () => {
    const rows = (await leaderboardRows(Number.MAX_SAFE_INTEGER)).filter(
      ({ username }) => username.startsWith("stats-leaderboard-"),
    );

    expect(rows).toEqual([
      {
        uid: uids.get(USERNAMES.bob),
        username: USERNAMES.bob,
        nickname: "Bob",
        submissions: 3,
        accepted: 3,
        solved: 2,
        firstBloods: 1,
      },
      {
        uid: uids.get(USERNAMES.alice),
        username: USERNAMES.alice,
        nickname: "Alice",
        submissions: 2,
        accepted: 1,
        solved: 1,
        firstBloods: 0,
      },
      {
        uid: uids.get(USERNAMES.carol),
        username: USERNAMES.carol,
        nickname: "Carol",
        submissions: 2,
        accepted: 1,
        solved: 1,
        firstBloods: 1,
      },
    ]);
  });
});

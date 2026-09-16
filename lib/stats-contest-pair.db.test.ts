import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accounts, contests, problems, submissions } from "@/lib/db/schema";
import { leaderboardRows } from "./stats";

const USERNAME = "stats-contest-problem-pair";
const PROBLEM = "stats-shared-problem";
const CONTESTS = ["stats-round-a", "stats-round-b"] as const;

let ACCOUNT_UID = 0;

async function reachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const online = await reachable();
const describeDb = online ? describe : describe.skip;

if (!online) {
  console.warn("[test] 数据库不可达，跳过全局排行榜聚合用例");
}

async function cleanup(): Promise<void> {
  const [account] = await db
    .select({ uid: accounts.uid })
    .from(accounts)
    .where(eq(accounts.username, USERNAME));

  if (account) {
    await db.delete(submissions).where(eq(submissions.uid, account.uid));
    await db.delete(accounts).where(eq(accounts.uid, account.uid));
  }

  await db.delete(contests).where(inArray(contests.slug, CONTESTS));
  await db.delete(problems).where(eq(problems.slug, PROBLEM));
}

describeDb("全局排行榜聚合", () => {
  beforeAll(async () => {
    await cleanup();

    await db.insert(problems).values({ slug: PROBLEM, title: "Shared Problem" });
    await db.insert(contests).values(
      CONTESTS.map((slug) => ({ slug, title: slug })),
    );

    const [account] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: USERNAME })
      .returning({ uid: accounts.uid });
    ACCOUNT_UID = account.uid;

    await db.insert(submissions).values(
      CONTESTS.map((contestSlug, index) => ({
        id: `sub_stats_pair_${index}`,
        uid: ACCOUNT_UID,
        problemSlug: PROBLEM,
        contestSlug,
        payload: {},
        backendId: "stats-fixture",
        state: "completed" as const,
        result: { status: "accepted", accepted: true },
        createdAt: new Date(`2026-01-0${index + 1}T00:00:00Z`),
        judgedAt: new Date(`2026-01-0${index + 1}T00:01:00Z`),
      })),
    );
  });

  afterAll(cleanup);

  it("同一题目出现在两个比赛时分别计 solved 与 first blood", async () => {
    const row = (await leaderboardRows(10_000)).find(
      ({ uid }) => uid === ACCOUNT_UID,
    );

    expect(row).toMatchObject({
      submissions: 2,
      accepted: 2,
      solved: 2,
      firstBloods: 2,
    });
  });
});

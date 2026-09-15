import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContestProblemRef } from "@/lib/authz/resources";
import { contestProblemRefs } from "@/lib/contests/refs";
import { db } from "@/lib/db";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { accounts, submissions } from "@/lib/db/schema";
import { viewerWith } from "@/test/content-shapes";
import { invalidateStandings } from "./cache";
import { standingsFor } from "./compute";

interface SharedProblemPair {
  target: ContestProblemRef;
  other: ContestProblemRef;
  at: Date;
}

function sharedProblemPair(): SharedProblemPair {
  const refs = contestProblemRefs();
  for (const target of refs) {
    if (target.contest.participants.mode !== "open") continue;

    for (const other of refs) {
      if (
        other.contest.slug === target.contest.slug ||
        other.problem.slug !== target.problem.slug
      ) {
        continue;
      }

      const overlapStart = Math.max(
        target.contest.startsAt.getTime(),
        other.contest.startsAt.getTime(),
      );
      const overlapEnd = Math.min(
        target.contest.endsAt.getTime(),
        other.contest.endsAt.getTime(),
      );
      if (overlapStart + 60_000 <= overlapEnd) {
        return { target, other, at: new Date(overlapStart + 60_000) };
      }
    }
  }
  throw new Error("内核测试需要两场时间重叠的比赛各自带着同一道题");
}

const { target: TARGET, other: OTHER, at: SUBMITTED_AT } = sharedProblemPair();
const READER = viewerWith("standings.read");
const USERNAME = "standings-contest-isolation";

let uid = 0;

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
  console.warn("[test] 数据库不可达，跳过排行榜比赛隔离集成用例");
}

async function cleanup() {
  const held = await db
    .select({ uid: accounts.uid })
    .from(accounts)
    .where(eq(accounts.username, USERNAME));

  for (const account of held) {
    await db.delete(submissions).where(eq(submissions.uid, account.uid));
    await db.delete(accounts).where(eq(accounts.uid, account.uid));
  }

  uid = 0;
  invalidateStandings(TARGET.contest.slug);
  invalidateStandings(OTHER.contest.slug);
}

describeDb("排行榜按比赛隔离提交", () => {
  beforeAll(async () => {
    await cleanup();
    await ensureProblem(TARGET.problem);
    await ensureContest(TARGET.contest);
    await ensureContest(OTHER.contest);

    const [account] = await db
      .insert(accounts)
      .values({ username: USERNAME, nickname: USERNAME })
      .returning({ uid: accounts.uid });
    uid = account.uid;

    await db.insert(submissions).values([
      {
        id: "sub_standings_target_attempt",
        uid,
        problemSlug: TARGET.problem.slug,
        contestSlug: TARGET.contest.slug,
        payload: {},
        backendId: "inline",
        state: "completed",
        result: { accepted: false },
        createdAt: SUBMITTED_AT,
        judgedAt: SUBMITTED_AT,
      },
      {
        id: "sub_standings_other_solve",
        uid,
        problemSlug: OTHER.problem.slug,
        contestSlug: OTHER.contest.slug,
        payload: {},
        backendId: "inline",
        state: "completed",
        result: { accepted: true },
        createdAt: SUBMITTED_AT,
        judgedAt: SUBMITTED_AT,
      },
    ]);
  });

  afterAll(cleanup);

  it("同一道题在另一场比赛里的通过不计入本场排行榜", async () => {
    const computed = await standingsFor(
      TARGET.contest.slug,
      READER,
      new Date(TARGET.contest.endsAt.getTime() + 60_000),
    );

    expect(computed).not.toBeNull();
    expect(computed?.boards).toHaveLength(1);
    expect(computed?.boards[0].standings.rows).toHaveLength(1);
    expect(computed?.boards[0].standings.rows[0]).toMatchObject({
      participant: { uid },
      total: 0,
    });
  });
});

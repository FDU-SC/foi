import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContestProblemRef } from "@/lib/authz/resources";
import { isCatalogue } from "@/lib/contests/catalogue";
import { contestProblemRefs } from "@/lib/contests/refs";
import { pairKey } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { accounts, submissions } from "@/lib/db/schema";
import { viewerWith } from "@/test/content-shapes";
import { invalidateStandings } from "./cache";
import { catalogueStandingsFor, standingsFor } from "./compute";

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

/** Two catalogued contests carrying the same problem, each scored in its own window. */
function cataloguedPair(): [ContestProblemRef, ContestProblemRef] {
  const refs = contestProblemRefs().filter(({ contest }) =>
    isCatalogue(contest.slug) && contest.participants.mode === "open");
  for (const first of refs) {
    const second = refs.find((ref) =>
      ref.problem.slug === first.problem.slug && ref.contest.slug !== first.contest.slug);
    if (second) return [first, second];
  }
  throw new Error("内核测试需要两个开放报名的题库分区带着同一道题");
}

const [SOLVED_IN, TRIED_IN] = cataloguedPair();
const CATALOGUE_USER = "standings-catalogue-board";
const minuteInto = (ref: ContestProblemRef) => new Date(ref.contest.startsAt.getTime() + 60_000);
let catalogueUid = 0;

async function cleanupCatalogue() {
  const held = await db.select({ uid: accounts.uid }).from(accounts).where(eq(accounts.username, CATALOGUE_USER));
  for (const account of held) {
    await db.delete(submissions).where(eq(submissions.uid, account.uid));
    await db.delete(accounts).where(eq(accounts.uid, account.uid));
  }
  invalidateStandings(SOLVED_IN.contest.slug);
  invalidateStandings(TRIED_IN.contest.slug);
}

describeDb("题库榜合并各分区的主榜", () => {
  beforeAll(async () => {
    await cleanupCatalogue();
    await ensureProblem(SOLVED_IN.problem);
    await ensureContest(SOLVED_IN.contest);
    await ensureContest(TRIED_IN.contest);
    const [account] = await db.insert(accounts)
      .values({ username: CATALOGUE_USER, nickname: CATALOGUE_USER })
      .returning({ uid: accounts.uid });
    catalogueUid = account.uid;
    const base = { uid: catalogueUid, problemSlug: SOLVED_IN.problem.slug, payload: {}, backendId: "inline", state: "completed" as const };
    await db.insert(submissions).values([
      { ...base, id: "sub_catalogue_solved", contestSlug: SOLVED_IN.contest.slug, result: { accepted: true }, createdAt: minuteInto(SOLVED_IN) },
      { ...base, id: "sub_catalogue_tried", contestSlug: TRIED_IN.contest.slug, result: { accepted: false }, createdAt: minuteInto(TRIED_IN) },
    ]);
  });

  afterAll(cleanupCatalogue);

  const after = () => new Date(Math.max(SOLVED_IN.contest.endsAt.getTime(), TRIED_IN.contest.endsAt.getTime()) + 60_000);
  const mine = (computed: Awaited<ReturnType<typeof catalogueStandingsFor>>) =>
    computed?.board.standings.rows.find(({ participant }) => participant.uid === catalogueUid);

  it("同一道题在两个分区里各占一列，各自按所在分区计分", async () => {
    const total = await catalogueStandingsFor({}, READER, after());
    expect(total?.sections.map(({ slug }) => slug)).toEqual(
      expect.arrayContaining([SOLVED_IN.contest.slug, TRIED_IN.contest.slug]),
    );
    expect(total?.problems.map(({ key }) => key)).toEqual(expect.arrayContaining([
      pairKey(SOLVED_IN.contest.slug, SOLVED_IN.problem.slug),
      pairKey(TRIED_IN.contest.slug, TRIED_IN.problem.slug),
    ]));
    expect(mine(total)).toMatchObject({ participant: { uid: catalogueUid, username: CATALOGUE_USER }, total: 1 });
  });

  it("按分区收窄后只算选中的分区，与该分区自己的主榜一致", async () => {
    const narrowed = await catalogueStandingsFor({ sections: [TRIED_IN.contest.slug] }, READER, after());
    expect(narrowed?.sections.map(({ slug }) => slug)).toEqual([TRIED_IN.contest.slug]);
    expect(mine(narrowed)).toMatchObject({ total: 0 });

    const own = await standingsFor(TRIED_IN.contest.slug, READER, after());
    expect(narrowed?.board.standings.rows.map(({ participant, total }) => [participant.uid, total]))
      .toEqual(own?.boards[0].standings.rows.map(({ participant, total }) => [participant.uid, total]));
  });

  it("时间窗口之外的提交不计，未知的榜没有结果", async () => {
    const earliest = Math.min(minuteInto(SOLVED_IN).getTime(), minuteInto(TRIED_IN).getTime());
    const day = 86_400_000;
    const covering = Math.ceil((after().getTime() - earliest) / day) + 1;
    expect(mine(await catalogueStandingsFor({ days: covering }, READER, after()))).toMatchObject({ total: 1 });
    expect(mine(await catalogueStandingsFor({ days: 0 }, READER, after()))).toBeUndefined();
    expect(await catalogueStandingsFor({ board: "no-such-board" }, READER, after())).toBeNull();
  });
});

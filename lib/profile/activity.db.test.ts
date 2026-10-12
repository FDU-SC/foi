import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { viewerFor } from "@/lib/authz/viewer";
import { catalogueSlugs, isCatalogue } from "@/lib/contests/catalogue";
import { contestProblemRefs, contestProblemRefsIn } from "@/lib/contests/refs";
import { allContests } from "@/lib/contests/registry";
import {
  acceptsSubmissions,
  hasContestEnded,
  pairKey,
  showsStatements,
} from "@/lib/contests/types";
import { db } from "@/lib/db";
import { ensureContest, ensureProblem } from "@/lib/db/mirror";
import { accounts, submissions } from "@/lib/db/schema";
import { interpretsProgress } from "@/lib/problems/progress";
import { stagedProblem } from "@/test/content-shapes";
import { activityFor } from "./activity";

const now = new Date();

/** A running catalogued round anyone sees, whose problems all interpret progress. */
const running = allContests().find((contest) => {
  const refs = contestProblemRefsIn(contest.slug);
  return isCatalogue(contest.slug) && contest.visibleTo === undefined &&
    acceptsSubmissions(contest, now) && refs.length >= 2 && refs.every(interpretsProgress);
})!;
const [early, late] = contestProblemRefsIn(running.slug).filter(interpretsProgress);

/** A finished round outside the catalogue whose problems stay readable. */
const finished = contestProblemRefs().find((ref) =>
  !isCatalogue(ref.contest.slug) && ref.contest.visibleTo === undefined &&
  hasContestEnded(ref.contest, now) && showsStatements(ref.contest, now))!;

/** A catalogued section holding a problem that interprets nothing. */
const partial = contestProblemRefs().find((ref) =>
  isCatalogue(ref.contest.slug) && ref.contest.visibleTo === undefined &&
  showsStatements(ref.contest, now) && !interpretsProgress(ref))!;

const hidden = stagedProblem();

// The sample fixture's progress treats a completed result of 7 as solved.
const SOLVED = 7;

const uids: number[] = [];
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("选手主页的做题记录", () => {
  beforeAll(async () => {
    for (const ref of [early, late, finished, partial, hidden]) {
      await ensureContest(ref.contest);
      await ensureProblem(ref.problem);
    }
    const users = await db.insert(accounts).values([
      { username: "activity-owner", nickname: "owner" },
      { username: "activity-peer", nickname: "peer" },
    ]).returning({ uid: accounts.uid });
    uids.push(...users.map(({ uid }) => uid));

    const row = (id: string, ref: typeof early, createdAt: Date, result: unknown) => ({
      id, uid: uids[0], contestSlug: ref.contest.slug, problemSlug: ref.problem.slug,
      payload: {}, backendId: "activity", state: "completed" as const, result, createdAt,
    });
    await db.insert(submissions).values([
      row("activity-early-miss", early, new Date("2026-08-31T16:10:00Z"), 0),
      row("activity-early", early, new Date("2026-08-31T16:30:00Z"), SOLVED),
      row("activity-early-again", early, new Date("2026-09-02T02:00:00Z"), 0),
      row("activity-late", late, new Date(now.getTime() - 10 * 60_000), SOLVED),
      row("activity-finished", finished, new Date(finished.contest.startsAt.getTime() + 60_000), 0),
      row("activity-partial", partial, new Date(partial.contest.startsAt.getTime() + 60_000), SOLVED),
      row("activity-hidden", hidden, new Date(hidden.contest.startsAt.getTime() + 60_000), SOLVED),
    ]);
  });

  afterAll(async () => {
    if (!uids.length) return;
    await db.delete(submissions).where(inArray(submissions.uid, uids));
    await db.delete(accounts).where(inArray(accounts.uid, uids));
  });

  /** Freeze the running round an hour ago, so the later submission falls after it. */
  async function frozen<T>(read: () => Promise<T>): Promise<T> {
    running.freezeAt = new Date(now.getTime() - 60 * 60_000);
    try {
      return await read();
    } finally {
      delete running.freezeAt;
    }
  }

  it("只计入查看者能看到排行榜的比赛，按站点时区分天", async () => {
    const activity = await activityFor(uids[0], viewerFor({ uid: uids[1], groups: [] }), now);

    expect(activity.submissions).toBe(6);
    expect(activity.days.get("2026-09-01")).toBe(2);
    expect(activity.days.get("2026-09-02")).toBe(1);
    expect(activity.days.has("2026-08-31")).toBe(false);
    expect(activity.pairs.map(({ ref }) => ref.contest.slug)).not.toContain(hidden.contest.slug);
    expect(activity.contests.map(({ slug }) => slug)).toEqual([finished.contest.slug]);
  });

  it("封榜后的结果对他人隐藏，本人仍能看到", async () => {
    const peer = await frozen(() => activityFor(uids[0], viewerFor({ uid: uids[1], groups: [] }), now));
    const self = await frozen(() => activityFor(uids[0], viewerFor({ uid: uids[0], groups: [] }), now));

    const stateOf = (activity: typeof peer, ref: typeof early) =>
      activity.pairs.find((pair) => pairKey(pair.ref.contest.slug, pair.ref.problem.slug) ===
        pairKey(ref.contest.slug, ref.problem.slug))?.progress?.state;

    expect(stateOf(peer, early)).toBe("solved");
    expect(stateOf(peer, late)).toBe("attempted");
    expect(stateOf(self, late)).toBe("solved");
    expect(peer.solved).toBe(1);
    expect(self.solved).toBe(2);
  });

  it("通过时间取第一次让内容判为通过的提交，之后的失败不改变它", async () => {
    const activity = await activityFor(uids[0], viewerFor({ uid: uids[0], groups: [] }), now);
    const find = (ref: typeof early) => activity.pairs.find((pair) =>
      pairKey(pair.ref.contest.slug, pair.ref.problem.slug) === pairKey(ref.contest.slug, ref.problem.slug));
    const first = find(early)!;

    expect(first.solvedAt).toEqual(new Date("2026-08-31T16:30:00Z"));
    expect(first.lastAt).toEqual(new Date("2026-09-02T02:00:00Z"));
    expect(first.submittedOn).toEqual(["2026-09-01", "2026-09-01", "2026-09-02"]);
    expect(find(finished)?.solvedAt).toBeNull();
    expect(activity.lastAt).toEqual(new Date(now.getTime() - 10 * 60_000));
  });

  it("有题目不解释进度的分区只给通过数，不给总数", async () => {
    const activity = await activityFor(uids[0], viewerFor({ uid: uids[0], groups: [] }), now);
    const section = (slug: string) => activity.sections.find(({ contest }) => contest.slug === slug);

    expect(activity.sections.map(({ contest }) => contest.slug))
      .toEqual(catalogueSlugs().filter((slug) => section(slug)));
    expect(section(running.slug)).toMatchObject({ solved: 2, total: contestProblemRefsIn(running.slug).length });
    expect(section(partial.contest.slug)).toMatchObject({ solved: 0, total: null });
    expect(activity.pairs.find(({ ref }) => ref.contest.slug === partial.contest.slug)?.progress).toBeNull();
  });
});

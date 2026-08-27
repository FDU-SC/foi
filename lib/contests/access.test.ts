import { describe, expect, it } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";
import { AS_PLAYER } from "@/test/auth-support";
import { type Viewer } from "@/lib/permissions/viewer";
import {
  contestWithGroupEntry,
  publicProblemOutside,
  viewerWith,
} from "@/test/content-shapes";
import {
  contestEntryFor,
  contestFor,
  contestsFor,
  contestVisibility,
  isContestProblemSetVisibleTo,
} from "./access";
import { allContests } from "./registry";
import { contestConfigSchema, type ContestConfig } from "./types";

const PREVIEW = viewerWith("problem.viewAll", "an-admin");

/**
 * Holders of exactly one capability each, spelled out rather than resolved
 * through `content/enrollment/`.
 *
 * The same choice `lib/backend/access.test.ts` makes for its setter: the gate
 * below asks one capability, and which group a deployment hands it to should
 * not be something these cases can notice. The group ids are decoration — the
 * `can` beside them is what the gate reads.
 */
const SETTER: Viewer = {
  handle: "setter",
  groups: ["出题人"],
  can: (capability) => capability === "problem.viewAll",
};

const CONTEST_READER: Viewer = {
  handle: "reader",
  groups: ["助教"],
  can: (capability) => capability === "contest.viewAll",
};

/** Any round this deployment ships, for the cases that only need one to exist. */
const anyContest = allContests()[0];

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

function after(date: Date): Date {
  return new Date(date.getTime() + 60_000);
}

function contest(overrides: Record<string, unknown>): ContestConfig {
  return contestConfigSchema.parse({
    slug: "test",
    title: "Test",
    ruleset: { id: "some-ruleset" },
    startsAt: "2026-01-15T13:00:00+08:00",
    endsAt: "2026-01-15T18:00:00+08:00",
    problems: [],
    ...overrides,
  });
}

describe("contestVisibility", () => {
  it("默认可见", () => {
    expect(contestVisibility(contest({}), AS_PLAYER)).toEqual({ visible: true });
  });

  it("visibleTo: [] 标为无人可见", () => {
    expect(contestVisibility(contest({ visibleTo: [] }), AS_PLAYER)).toEqual({
      visible: false,
      reason: "audience",
      audience: [],
    });
  });
});

describe("contestsFor", () => {
  it("选手视角下不含未公开的比赛", () => {
    for (const { gate } of contestsFor(AS_PLAYER)) {
      expect(gate.visible).toBe(true);
    }
  });

  it("预览视角带上未公开的比赛并标出原因", () => {
    const withPreview = contestsFor(PREVIEW);
    expect(withPreview.length).toBe(allContests().length);
    for (const entry of withPreview) {
      if (!entry.gate.visible) expect(entry.gate.reason).toBe("audience");
    }
  });

  it("未开始的比赛照常出现在列表里", () => {
    // Only the problem set is withheld before the start; the contest itself is
    // an announcement.
    if (!anyContest) return;
    expect(contestsFor(AS_PLAYER).map((e) => e.config.slug)).toContain(
      anyContest.slug,
    );
  });
});

describe("contestFor", () => {
  it("已公开的比赛对选手可取", () => {
    if (!anyContest) return;
    expect(contestFor(anyContest.slug, AS_PLAYER)?.config.slug).toBe(anyContest.slug);
  });

  it("不存在的 slug 返回 undefined", () => {
    expect(contestFor("no-such-contest", AS_PLAYER)).toBeUndefined();
    expect(contestFor("no-such-contest", PREVIEW)).toBeUndefined();
  });

  it("与 contestsFor 对同一场比赛的判断一致", () => {
    for (const { config, gate } of contestsFor(PREVIEW)) {
      expect(contestFor(config.slug, PREVIEW)?.gate).toEqual(gate);
    }
  });
});

/**
 * The four cells both contest pages branch on.
 *
 * They used to be worked out a page at a time — the clock half here, the
 * capability half written out on the contest page and again on the standings
 * page — so the matrix is what says the merged answer still means what each
 * half meant on its own.
 */
describe("isContestProblemSetVisibleTo", () => {
  const round = contest({});
  const beforeStart = before(round.startsAt);
  const afterEnd = after(round.endsAt);

  it("未开始 + 没有 problem.viewAll：扣住", () => {
    expect(isContestProblemSetVisibleTo(round, AS_PLAYER, beforeStart)).toBe(
      false,
    );
  });

  it("未开始 + 有 problem.viewAll：放行，这是校对未开赛轮次的入口", () => {
    expect(isContestProblemSetVisibleTo(round, SETTER, beforeStart)).toBe(true);
  });

  it("已开始 + 没有 problem.viewAll：放行", () => {
    expect(isContestProblemSetVisibleTo(round, AS_PLAYER, round.startsAt)).toBe(
      true,
    );
    expect(isContestProblemSetVisibleTo(round, AS_PLAYER, afterEnd)).toBe(true);
  });

  it("已开始 + 有 problem.viewAll：放行，能力不改变已经公开的答案", () => {
    expect(isContestProblemSetVisibleTo(round, SETTER, round.startsAt)).toBe(
      true,
    );
    expect(isContestProblemSetVisibleTo(round, SETTER, afterEnd)).toBe(true);
  });

  it("contest.viewAll 不开题单：能读这场比赛，不等于能看它有几道题", () => {
    expect(
      isContestProblemSetVisibleTo(round, CONTEST_READER, beforeStart),
    ).toBe(false);
  });

  it("真实分流里持有 problem.viewAll 的组也是预览者", () => {
    if (!anyContest) return;
    expect(
      isContestProblemSetVisibleTo(anyContest, PREVIEW, before(anyContest.startsAt)),
    ).toBe(true);
  });
});

/**
 * The merged `resolveContest`.
 *
 * It was written three times and the three had drifted — the statement page
 * had dropped `gate.visible` — so what these cases are really pinning is that
 * one answer now exists for all four facts, and that the two refusals stay
 * distinguishable for the one caller that owes its client the difference.
 */
describe("contestEntryFor", () => {
  const { contest: round_, entry: ENTRY, group: GROUP } = contestWithGroupEntry();
  const demo = round_;

  /** Inside the round's window, so it is open. */
  const DURING = new Date(demo.startsAt.getTime() + 60_000);
  const AFTER = new Date(demo.endsAt.getTime() + 60_000);

  function user(groups: string[]): Pick<ResolvedUser, "handle" | "groups"> {
    return { handle: "entry-alice", groups };
  }

  const ENTRANT = user([GROUP]);
  const OUTSIDER = user([]);

  /** A problem this round does not list, so naming the two together is a mismatch. */
  const UNLISTED = publicProblemOutside(demo, DURING);

  it("四个事实都成立时给出比赛与它的题目条目", () => {
    const round = contestEntryFor(demo.slug, ENTRY.slug, ENTRANT, DURING);

    expect(round.ok).toBe(true);
    if (!round.ok) return;

    expect(round.contest.slug).toBe(demo.slug);
    // The entry is what the round says about *this* problem, and the reason
    // the caller is handed it rather than the contest alone.
    expect(round.problemEntry.slug).toBe(ENTRY.slug);
    expect(round.problemEntry.label).toBe(ENTRY.label);
  });

  it("比赛已结束是 contest-mismatch", () => {
    expect(contestEntryFor(demo.slug, ENTRY.slug, ENTRANT, AFTER)).toEqual({
      ok: false,
      reason: "contest-mismatch",
    });
  });

  it("比赛不包含这道题是 contest-mismatch", () => {
    expect(contestEntryFor(demo.slug, UNLISTED.slug, ENTRANT, DURING)).toEqual({
      ok: false,
      reason: "contest-mismatch",
    });
  });

  /**
   * The empty string is a client naming a contest and naming it wrong, and it
   * gets the same answer any other unresolvable slug gets. Absence is spelled
   * by not calling this at all.
   */
  it("不存在的 slug 与空串都是 contest-mismatch", () => {
    for (const slug of ["没有这场比赛", ""]) {
      expect(contestEntryFor(slug, ENTRY.slug, ENTRANT, DURING)).toEqual({
        ok: false,
        reason: "contest-mismatch",
      });
    }
  });

  it("比赛开着但人不在名单里是 not-entered", () => {
    expect(contestEntryFor(demo.slug, ENTRY.slug, OUTSIDER, DURING)).toEqual({
      ok: false,
      reason: "not-entered",
    });
  });

  /**
   * Anonymous reads a public round and enters none. Separated from the case
   * above only because null takes a different path to the same answer.
   */
  it("未登录同样是 not-entered", () => {
    expect(contestEntryFor(demo.slug, ENTRY.slug, null, DURING)).toEqual({
      ok: false,
      reason: "not-entered",
    });
  });

  /**
   * Order matters: naming a round the caller may not see must not be
   * distinguishable from naming one that does not contain the problem, or the
   * 403 below would confirm a staged round's contents.
   */
  it("看不见的比赛答 contest-mismatch，而不是 not-entered", () => {
    // No staged round ships, so this pins the ordering on the one axis the
    // repository can exercise: an unresolvable slug never reaches the entry
    // check, whatever the caller's groups are.
    expect(contestEntryFor("没有这场比赛", ENTRY.slug, OUTSIDER, DURING)).toEqual(
      { ok: false, reason: "contest-mismatch" },
    );
  });
});

import { describe, expect, it } from "vitest";
import { AS_PLAYER, viewerFor, type Viewer } from "@/lib/auth/viewer";
import {
  contestFor,
  contestsFor,
  contestVisibility,
  isContestProblemSetVisibleTo,
} from "./access";
import { allContests } from "./registry";
import { contestConfigSchema, type ContestConfig } from "./types";

const PREVIEW = viewerFor({ handle: "an-admin", groups: ["管理员"] });

/**
 * Holders of exactly one capability each, spelled out rather than resolved
 * through `content/enrollment/`.
 *
 * The same choice `lib/backend/access.test.ts` makes for its setter: the gate
 * below asks one capability, and a deployment that hands it to a group other
 * than 管理员 should get the behaviour without the test noticing.
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

const demo = allContests().find((contest) => contest.slug === "demo-acm");

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
    ruleset: { id: "acm" },
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
    if (!demo) return;
    expect(contestsFor(AS_PLAYER).map((e) => e.config.slug)).toContain(
      demo.slug,
    );
  });
});

describe("contestFor", () => {
  it("已公开的比赛对选手可取", () => {
    if (!demo) return;
    expect(contestFor(demo.slug, AS_PLAYER)?.config.slug).toBe(demo.slug);
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

  it("管理员在真实分流下也是预览者", () => {
    if (!demo) return;
    expect(
      isContestProblemSetVisibleTo(demo, PREVIEW, before(demo.startsAt)),
    ).toBe(true);
  });
});

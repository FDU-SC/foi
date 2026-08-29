import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import {
  contestWithGroupEntry,
  publicProblemOutside,
  viewerWith,
} from "@/test/content-shapes";
import {
  contestEntryFor,
  contestFor,
  contestsFor,
  isContestProblemSetVisibleTo,
} from "./access";
import { allContests } from "./registry";
import { contestConfigSchema, type ContestConfig } from "./types";

const STAFF = viewerWith("contest.readProblemSet", 100);
const PLAIN = viewerFor({ uid: 102, groups: [] });

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
    leaderboards: [{ id: "main", title: "排行榜", ruleset: { id: "some-ruleset" } }],
    startsAt: "2026-01-15T13:00:00+08:00",
    endsAt: "2026-01-15T18:00:00+08:00",
    problems: [],
    ...overrides,
  });
}

describe("contestsFor", () => {
  it("选手视角下没有一场是预览", () => {
    for (const view of contestsFor(AS_PLAYER)) {
      expect(view.preview).toBe(false);
    }
  });

  it("能预览的人拿到全部比赛，含对任何人都不可见的暂存轮次", () => {
    const withPreview = contestsFor(viewerWith("contest.read", 100));
    expect(withPreview.length).toBe(allContests().length);
  });

  it("未开始的比赛照常出现在列表里", () => {
    if (!anyContest) return;
    expect(contestsFor(AS_PLAYER).map((e) => e.config.slug)).toContain(
      anyContest.slug,
    );
  });
});

describe("contestFor", () => {
  it("已公开的比赛对选手可取", () => {
    if (!anyContest) return;
    expect(contestFor(anyContest.slug, AS_PLAYER)?.config.slug).toBe(
      anyContest.slug,
    );
  });

  it("不存在的 slug 返回 undefined", () => {
    expect(contestFor("no-such-contest", AS_PLAYER)).toBeUndefined();
    expect(contestFor("no-such-contest", STAFF)).toBeUndefined();
  });

  it("与 contestsFor 对同一场比赛的判断一致", () => {
    for (const view of contestsFor(STAFF)) {
      expect(contestFor(view.config.slug, STAFF)).toEqual(view);
    }
  });
});

describe("isContestProblemSetVisibleTo", () => {
  const round = contest({});
  const beforeStart = before(round.startsAt);
  const afterEnd = after(round.endsAt);

  it("未开始、又没有被单独放行：扣住", () => {
    expect(isContestProblemSetVisibleTo(round, AS_PLAYER, beforeStart)).toBe(
      false,
    );
  });

  it("未开始但被策略放行：这是校对未开赛轮次的入口", () => {
    expect(isContestProblemSetVisibleTo(round, STAFF, beforeStart)).toBe(true);
  });

  it("已开始之后对所有看得到这场比赛的人放行", () => {
    expect(isContestProblemSetVisibleTo(round, AS_PLAYER, round.startsAt)).toBe(
      true,
    );
    expect(isContestProblemSetVisibleTo(round, AS_PLAYER, afterEnd)).toBe(true);
  });

  it("能预览不改变已经公开的答案", () => {
    expect(isContestProblemSetVisibleTo(round, STAFF, round.startsAt)).toBe(
      true,
    );
    expect(isContestProblemSetVisibleTo(round, STAFF, afterEnd)).toBe(true);
  });

  it("只是登录了并不会提前看到题单", () => {
    expect(isContestProblemSetVisibleTo(round, PLAIN, beforeStart)).toBe(false);
  });
});

describe("contestEntryFor", () => {
  const { contest: demo, entry: ENTRY, group: GROUP } = contestWithGroupEntry();

  const DURING = new Date(demo.startsAt.getTime() + 60_000);
  const AFTER = new Date(demo.endsAt.getTime() + 60_000);

  function user(groups: string[]): Viewer {
    return viewerFor({ uid: 10, groups });
  }

  const ENTRANT = user([GROUP]);
  const OUTSIDER = user([]);

  const UNLISTED = publicProblemOutside(demo, DURING);

  function refusalOf(
    contestSlug: string,
    problemSlug: string,
    viewer: Viewer,
    now: Date,
  ): string | undefined {
    const round = contestEntryFor(contestSlug, problemSlug, viewer, now);
    return round.ok ? undefined : round.denial.reason.code;
  }

  it("四个事实都成立时给出比赛与它的题目条目", () => {
    const round = contestEntryFor(demo.slug, ENTRY.slug, ENTRANT, DURING);

    expect(round.ok).toBe(true);
    if (!round.ok) return;

    expect(round.contest.slug).toBe(demo.slug);

    expect(round.problemEntry.slug).toBe(ENTRY.slug);
    expect(round.problemEntry.label).toBe(ENTRY.label);
  });

  it("比赛已结束是 contest-closed", () => {
    expect(refusalOf(demo.slug, ENTRY.slug, ENTRANT, AFTER)).toBe(
      "contest-closed",
    );
  });

  it("比赛不包含这道题是 contest-mismatch", () => {
    expect(refusalOf(demo.slug, UNLISTED.slug, ENTRANT, DURING)).toBe(
      "contest-mismatch",
    );
  });

  it("不存在的 slug 与空串都是 contest-mismatch", () => {
    for (const slug of ["没有这场比赛", ""]) {
      expect(refusalOf(slug, ENTRY.slug, ENTRANT, DURING)).toBe(
        "contest-mismatch",
      );
    }
  });

  it("比赛开着但人不在名单里是 not-entered", () => {
    expect(refusalOf(demo.slug, ENTRY.slug, OUTSIDER, DURING)).toBe(
      "not-entered",
    );
  });

  it("未登录是 unauthenticated，而不是「不在名单里」", () => {
    expect(refusalOf(demo.slug, ENTRY.slug, AS_PLAYER, DURING)).toBe(
      "unauthenticated",
    );
  });

  it("没有任何策略能把人塞进闭门赛", () => {
    const everything = viewerWith("contest.read", 11);
    expect(refusalOf(demo.slug, ENTRY.slug, everything, DURING)).toBe(
      "not-entered",
    );
  });
});

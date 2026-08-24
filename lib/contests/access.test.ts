import { describe, expect, it } from "vitest";
import { AS_PLAYER, viewerFor } from "@/lib/auth/viewer";
import {
  contestFor,
  contestsFor,
  contestVisibility,
  isContestProblemSetVisible,
} from "./access";
import { allContests } from "./registry";
import { contestConfigSchema, type ContestConfig } from "./types";

const PREVIEW = viewerFor({ handle: "an-admin", groups: ["管理员"] });

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

describe("isContestProblemSetVisible", () => {
  it("未开始的比赛不展示题单", () => {
    if (!demo) return;
    expect(isContestProblemSetVisible(demo, before(demo.startsAt))).toBe(false);
  });

  it("进行中与已结束的比赛展示题单", () => {
    if (!demo) return;
    expect(isContestProblemSetVisible(demo, demo.startsAt)).toBe(true);
    expect(isContestProblemSetVisible(demo, after(demo.endsAt))).toBe(true);
  });
});

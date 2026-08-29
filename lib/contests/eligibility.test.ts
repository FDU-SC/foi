import { describe, expect, it } from "vitest";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { canEnterContest } from "./access";
import { contestConfigSchema, type ContestConfig } from "./types";

const DURING = new Date("2026-01-15T14:00:00+08:00");

function contest(
  participants: ContestConfig["participants"],
): ContestConfig {
  return contestConfigSchema.parse({
    slug: "test",
    title: "Test",
    leaderboards: [{ id: "main", title: "排行榜", ruleset: { id: "some-ruleset" } }],
    startsAt: "2026-01-15T13:00:00+08:00",
    endsAt: "2026-01-15T18:00:00+08:00",
    problems: [],
    participants,
  });
}

function user(uid: number, groups: string[]): Viewer {
  return viewerFor({ uid, groups });
}

describe("canEnterContest", () => {
  it("open 放行任何登录的人", () => {
    expect(canEnterContest(contest({ mode: "open" }), user(1, []), DURING)).toBe(
      true,
    );
  });

  it("group 只放行属于该组的人", () => {
    const c = contest({ mode: "group", group: "2026-校队" });

    expect(canEnterContest(c, user(2, ["2026-校队"]), DURING)).toBe(true);
    expect(canEnterContest(c, user(3, ["2025-校队"]), DURING)).toBe(false);
    expect(canEnterContest(c, user(4, []), DURING)).toBe(false);
  });

  it("list 只放行名单上的 uid", () => {
    const c = contest({ mode: "list", uids: [2, 3] });

    expect(canEnterContest(c, user(2, []), DURING)).toBe(true);
    expect(canEnterContest(c, user(4, []), DURING)).toBe(false);
  });

  it("组名匹配是精确的，不做前缀或包含", () => {
    const c = contest({ mode: "group", group: "2026级" });

    expect(canEnterContest(c, user(2, ["2026级本科生"]), DURING)).toBe(false);
  });

  it("匿名的人参加不了任何比赛，哪怕它对所有人开放", () => {
    expect(
      canEnterContest(contest({ mode: "open" }), viewerFor(null), DURING),
    ).toBe(false);
  });

  it("赛前赛后都不能作为参赛者动作", () => {
    const c = contest({ mode: "open" });

    expect(canEnterContest(c, user(1, []), new Date("2026-01-15T12:00:00+08:00"))).toBe(false);
    expect(canEnterContest(c, user(1, []), new Date("2026-01-15T19:00:00+08:00"))).toBe(false);
  });
});

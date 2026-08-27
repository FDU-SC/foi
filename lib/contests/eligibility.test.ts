import { describe, expect, it } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";
import { canEnterContest } from "./access";
import { contestConfigSchema, type ContestConfig } from "./types";

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

function user(
  uid: number,
  groups: string[],
): Pick<ResolvedUser, "uid" | "groups"> {
  return { uid, groups };
}

describe("canEnterContest", () => {
  it("open 放行任何人", () => {
    expect(canEnterContest(contest({ mode: "open" }), user(1, []))).toBe(
      true,
    );
  });

  it("group 只放行属于该组的人", () => {
    const c = contest({ mode: "group", group: "2026-校队" });

    expect(canEnterContest(c, user(2, ["2026-校队"]))).toBe(true);
    expect(canEnterContest(c, user(3, ["2025-校队"]))).toBe(false);
    expect(canEnterContest(c, user(4, []))).toBe(false);
  });

  it("list 只放行名单上的 uid", () => {
    const c = contest({ mode: "list", uids: [2, 3] });

    expect(canEnterContest(c, user(2, []))).toBe(true);
    expect(canEnterContest(c, user(4, []))).toBe(false);
  });

  it("组名匹配是精确的，不做前缀或包含", () => {
    const c = contest({ mode: "group", group: "2026级" });

    expect(canEnterContest(c, user(2, ["2026级本科生"]))).toBe(false);
  });
});

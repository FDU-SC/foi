import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site", () => ({ site: {
  catalogue: ["one", "two", "toy"],
  catalogueLeaderboards: [
    { id: "direction", title: "方向", sections: ["one", "two"], includeInTotal: true },
    { id: "toy", title: "独立方向", sections: ["toy"], includeInTotal: false },
  ],
} }));
import { catalogueBoardFor, catalogueRedirect, standingsHref, leaderboardHref } from "./catalogue";

describe("题库方向榜地址", () => {
  it("同方向分区共享地址，独立方向保留自己的榜", () => {
    expect(standingsHref("one")).toBe("/leaderboard?board=direction");
    expect(standingsHref("two")).toBe(standingsHref("one"));
    expect(standingsHref("toy")).toBe("/leaderboard?board=toy");
    expect(leaderboardHref()).toBe("/leaderboard");
    expect(catalogueBoardFor("ordinary")).toBeUndefined();
    expect(standingsHref("ordinary")).toBe("/contests/ordinary/standings");
  });
  it("两个历史命名空间都跳转，题目与分区地址不变", () => {
    expect(catalogueRedirect("/problems/one/standings")).toBe(standingsHref("one"));
    expect(catalogueRedirect("/problems/one/standings/")).toBe(standingsHref("one"));
    expect(catalogueRedirect("/contests/one/standings")).toBe(standingsHref("one"));
    expect(catalogueRedirect("/problems/one")).toBeNull();
    expect(catalogueRedirect("/problems/one/question")).toBeNull();
    expect(catalogueRedirect("/contests/ordinary/standings")).toBeNull();
  });
});

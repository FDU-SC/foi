import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site", () => ({ site: {
  catalogue: ["one", "two", "toy", "loose"],
  catalogueLeaderboards: [
    { id: "direction", title: "方向", sections: ["two", "one"], includeInTotal: true },
    { id: "toy", title: "独立方向", sections: ["toy"], includeInTotal: false },
  ],
} }));
import {
  catalogueBoardFor,
  catalogueBoardSections,
  catalogueRedirect,
  leaderboardHref,
  standingsHref,
} from "./catalogue";

describe("题库方向榜地址", () => {
  it("分区的排行榜是所属方向榜，并预选这个分区", () => {
    expect(standingsHref("one")).toBe("/leaderboard?board=direction&section=one");
    expect(standingsHref("two")).toBe("/leaderboard?board=direction&section=two");
    expect(standingsHref("toy")).toBe("/leaderboard?board=toy&section=toy");
    expect(leaderboardHref()).toBe("/leaderboard");
    expect(leaderboardHref("direction")).toBe("/leaderboard?board=direction");
    expect(catalogueBoardFor("ordinary")).toBeUndefined();
    expect(standingsHref("ordinary")).toBe("/contests/ordinary/standings");
    expect(standingsHref("loose")).toBe("/leaderboard?section=loose");
  });

  it("两个历史命名空间都跳转，题目与分区地址不变", () => {
    expect(catalogueRedirect("/problems/one/standings")).toBe(standingsHref("one"));
    expect(catalogueRedirect("/problems/one/standings/")).toBe(standingsHref("one"));
    expect(catalogueRedirect("/contests/one/standings")).toBe(standingsHref("one"));
    expect(catalogueRedirect("/problems/loose/standings")).toBe("/leaderboard?section=loose");
    expect(catalogueRedirect("/problems/one")).toBeNull();
    expect(catalogueRedirect("/problems/one/question")).toBeNull();
    expect(catalogueRedirect("/contests/ordinary/standings")).toBeNull();
  });
});

describe("题库榜覆盖的分区", () => {
  it("方向榜按题库顺序列出自己的分区，未知的榜什么都不覆盖", () => {
    expect(catalogueBoardSections("direction")).toEqual(["one", "two"]);
    expect(catalogueBoardSections("toy")).toEqual(["toy"]);
    expect(catalogueBoardSections("missing")).toBeUndefined();
  });

  it("总榜含计入总榜的方向与不属于任何方向的分区，排除只被不计入总榜的方向收录的分区", () => {
    expect(catalogueBoardSections()).toEqual(["one", "two", "loose"]);
  });
});

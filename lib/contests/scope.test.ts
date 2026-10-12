import { describe, expect, it, vi } from "vitest";
import type { ContestConfig } from "./types";

vi.mock("@/lib/site", () => ({ site: {
  catalogue: ["kernel", "comm", "graphs", "dp", "toys", "loose"],
  catalogueLeaderboards: [
    { id: "hpc", title: "HPC", sections: ["kernel", "comm"], includeInTotal: true },
    { id: "algo", title: "算法", sections: ["graphs", "dp"], includeInTotal: true },
    { id: "toys", title: "玩具箱", sections: ["toys"], includeInTotal: false },
  ],
} }));

const { boardScopeOf, catalogueScopeOf, directionsOf, gathers, sameBoardScope } = await import("./scope");

function contest(slug: string, domain?: string): ContestConfig {
  return { slug, domain } as ContestConfig;
}

const directions = directionsOf([
  contest("toys", "娱乐"),
  contest("kernel", "HPC"),
  contest("graphs", "算法"),
  contest("comm", "HPC"),
  contest("dp", "算法"),
  contest("loose"),
]);

describe("题库的方向", () => {
  it("按首次出现的顺序分组，没有方向的排在最后；只有一个分区的方向不单独成范围", () => {
    expect(directions.map(({ heading, contests }) => [heading, contests.map(({ slug }) => slug)])).toEqual([
      ["娱乐", ["toys"]],
      ["HPC", ["kernel", "comm"]],
      ["算法", ["graphs", "dp"]],
      [null, ["loose"]],
    ]);
    expect(directions.filter(gathers).map(({ heading }) => heading)).toEqual(["HPC", "算法"]);
  });
});

describe("题单范围与排行榜范围互相对应", () => {
  it("全部对应总榜，方向对应它的方向榜，分区对应所属方向榜里的这个分区", () => {
    expect(boardScopeOf(null, directions)).toEqual({ sections: [] });
    expect(boardScopeOf({ domain: "HPC" }, directions)).toEqual({ board: "hpc", sections: [] });
    expect(boardScopeOf({ section: "graphs" }, directions)).toEqual({ board: "algo", sections: ["graphs"] });
    expect(boardScopeOf({ section: "toys" }, directions), "独占一个榜的分区就是那个榜").toEqual({ board: "toys", sections: [] });
    expect(boardScopeOf({ section: "loose" }, directions)).toEqual({ board: undefined, sections: ["loose"] });
  });

  it("反过来从排行榜范围找回题单范围，找不到对应的就是没有", () => {
    expect(catalogueScopeOf({ sections: [] }, directions)).toBeNull();
    expect(catalogueScopeOf({ board: "algo", sections: [] }, directions)).toEqual({ domain: "算法" });
    expect(catalogueScopeOf({ board: "algo", sections: ["graphs", "dp"] }, directions)).toEqual({ domain: "算法" });
    expect(catalogueScopeOf({ board: "hpc", sections: ["comm"] }, directions)).toEqual({ section: "comm" });
    expect(catalogueScopeOf({ board: "toys", sections: [] }, directions)).toEqual({ section: "toys" });
    expect(catalogueScopeOf({ board: "hpc", sections: ["kernel", "graphs"] }, directions)).toBeUndefined();
  });

  it("比较时覆盖整个榜的分区等于不选分区，顺序无关", () => {
    expect(sameBoardScope({ board: "algo", sections: ["dp", "graphs"] }, { board: "algo", sections: [] })).toBe(true);
    expect(sameBoardScope({ sections: ["b", "a"] }, { sections: ["a", "b"] })).toBe(true);
    expect(sameBoardScope({ board: "algo", sections: ["dp"] }, { board: "algo", sections: [] })).toBe(false);
  });
});

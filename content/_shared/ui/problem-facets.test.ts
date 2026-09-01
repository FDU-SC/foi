import { describe, expect, it } from "vitest";
import { collectFacets } from "@/lib/problems/facets";
import { allProblems } from "@/lib/problems/registry";
import { toPublicConfig } from "@/lib/problems/types";
import { viewsFor } from "@/lib/problems/views";
import { DIFFICULTIES, problemFacets } from "./problem-facets";
import { problemUi } from "./ui-config";

/** 下架的题不进目录，也就无所谓筛不筛得到。 */
const catalogue = allProblems().filter((problem) => !problem.retired);

const facetsOf = (config: (typeof catalogue)[number]) =>
  problemFacets(toPublicConfig(config));

const uiOf = (config: (typeof catalogue)[number]) =>
  problemUi(toPublicConfig(config));

describe("problemFacets", () => {
  it("难度取值都在阶梯上，写错一个字它就掉到筛选栏末尾去了", () => {
    for (const config of catalogue) {
      const { difficulty } = uiOf(config);
      if (!difficulty) continue;
      expect(DIFFICULTIES, config.slug).toContain(difficulty);
    }
  });

  it("没写难度的题在难度那一维上没有取值", () => {
    const bare = catalogue.filter((config) => !uiOf(config).difficulty);
    expect(
      bare.length,
      "每道题都写了难度，「难度可以缺省」就没被验证",
    ).toBeGreaterThan(0);

    for (const config of bare) {
      const facet = facetsOf(config).find((one) => one.key === "difficulty");
      expect(facet?.values, config.slug).toEqual([]);
    }
  });

  it("标签原样成为可筛的取值", () => {
    for (const config of catalogue) {
      const facet = facetsOf(config).find((one) => one.key === "tags");
      expect(facet?.values, config.slug).toEqual(uiOf(config).tags);
    }
  });
});

describe("题库筛选接上了每一道题", () => {
  it("在册的题都登记了 facets，漏一道它就在任何筛选下消失", () => {
    expect(
      catalogue
        .filter((config) => viewsFor(config.slug).facets === undefined)
        .map((config) => config.slug),
    ).toEqual([]);
  });

  it("筛选栏给出难度和标签两维", () => {
    expect(collectFacets(catalogue).map((group) => group.key)).toEqual([
      "difficulty",
      "tags",
    ]);
  });
});

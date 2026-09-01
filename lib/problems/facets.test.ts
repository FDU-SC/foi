import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import {
  collectFacets,
  facetCounts,
  facetsOf,
  matchesFacets,
} from "./facets";
import { allProblems } from "./registry";
import type { ProblemConfig } from "./types";

const catalogue = allProblems();
const groups = collectFacets(catalogue);

function valuesOn(key: string, config: ProblemConfig): string[] {
  return facetsOf(config).flatMap((facet) =>
    facet.key === key ? facet.values : [],
  );
}

function carriers(key: string, value: string): string[] {
  return catalogue
    .filter((config) => valuesOn(key, config).includes(value))
    .map((config) => config.slug);
}

function declaredOrder(key: string): string[] | undefined {
  return catalogue
    .flatMap((config) => facetsOf(config))
    .find((facet) => facet.key === key && facet.order)?.order;
}

function appearanceIn(key: string): string[] {
  return [
    ...new Set(catalogue.flatMap((config) => valuesOn(key, config))),
  ];
}

describe("facetsOf", () => {
  it("没登记分面的题拿到空清单，而不是抛错", () => {
    expect(
      catalogue.filter((config) => facetsOf(config).length === 0).length,
    ).toBeGreaterThan(0);
  });

  it("同一道题只向内容层要一次", () => {
    expect(facetsOf(catalogue[0])).toBe(facetsOf(catalogue[0]));
  });
});

describe("collectFacets", () => {
  it("维度按题目交出它们的先后排列", () => {
    const offered = new Set(groups.map((group) => group.key));
    const appearance = [
      ...new Set(
        catalogue.flatMap((config) => facetsOf(config).map((f) => f.key)),
      ),
    ];

    expect(groups.map((group) => group.key)).toEqual(
      appearance.filter((key) => offered.has(key)),
    );
  });

  it("谁都没有取值的维度不出现，否则筛选栏上是一行空标题", () => {
    for (const group of groups) {
      expect(group.values.length, group.key).toBeGreaterThan(0);
    }
  });

  it("声明过顺序的维度照声明排，声明里没有的取值缀在后面", () => {
    const group = groups.find((one) => declaredOrder(one.key));
    expect(group, "夹具里没有声明过顺序的维度").toBeDefined();

    const declared = declaredOrder(group!.key)!;
    const known = group!.values.filter((value) => declared.includes(value));
    const rest = group!.values.filter((value) => !declared.includes(value));

    expect(known).toEqual(
      declared.filter((value) => group!.values.includes(value)),
    );
    expect(
      group!.values,
      "声明里没有的取值插进了声明的取值之间",
    ).toEqual([...known, ...rest]);
  });

  it("声明里有、但谁都没占的取值不出现——那是一条筛不出东西的链接", () => {
    const group = groups.find((one) => declaredOrder(one.key))!;
    const unused = declaredOrder(group.key)!.filter(
      (value) => carriers(group.key, value).length === 0,
    );

    expect(unused.length, "夹具的声明里没有空着的一档").toBeGreaterThan(0);
    for (const value of unused) expect(group.values).not.toContain(value);
  });

  it("没声明顺序的维度按频次从多到少排", () => {
    const group = groups.find((one) => !declaredOrder(one.key));
    expect(group, "夹具里没有未声明顺序的维度").toBeDefined();

    const counts = group!.values.map(
      (value) => carriers(group!.key, value).length,
    );

    expect(
      new Set(counts).size,
      "夹具里取值频次全一样，按不按频次排看不出来",
    ).toBeGreaterThan(1);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("频次并列时按站点语言排，而不是按题目交出的先后", () => {
    const group = groups.find((one) => !declaredOrder(one.key))!;
    const countOf = new Map(
      group.values.map((value) => [value, carriers(group.key, value).length]),
    );

    const runs = [...new Set(countOf.values())]
      .map((count) =>
        group.values.filter((value) => countOf.get(value) === count),
      )
      .filter((run) => run.length > 1);

    expect(runs.length, "夹具里没有频次并列的取值").toBeGreaterThan(0);

    const appearance = appearanceIn(group.key);
    for (const run of runs) {
      expect(run).toEqual(
        [...run].sort((a, b) => a.localeCompare(b, site.lang)),
      );
      expect(
        run,
        "夹具交出并列的取值时本来就是语言序，排没排看不出来",
      ).not.toEqual(appearance.filter((value) => run.includes(value)));
    }
  });
});

describe("matchesFacets", () => {
  const empty = Object.fromEntries(groups.map((group) => [group.key, []]));

  it("什么都没选就放行一切", () => {
    for (const config of catalogue) {
      expect(matchesFacets(config, {}), config.slug).toBe(true);
      expect(matchesFacets(config, empty), config.slug).toBe(true);
    }
  });

  it("一个维度里选多个取值是「任一即可」", () => {
    const group = groups.find((one) => one.values.length > 1)!;
    const [first, second] = group.values;

    const either = catalogue
      .filter((config) => matchesFacets(config, { [group.key]: [first, second] }))
      .map((config) => config.slug);

    expect(either.sort()).toEqual(
      [...new Set([...carriers(group.key, first), ...carriers(group.key, second)])].sort(),
    );
  });

  it("跨维度是「都要满足」", () => {
    const [first, second] = groups;
    const selection = {
      [first.key]: [first.values[0]],
      [second.key]: [second.values[0]],
    };

    for (const config of catalogue) {
      expect(matchesFacets(config, selection), config.slug).toBe(
        valuesOn(first.key, config).includes(first.values[0]) &&
          valuesOn(second.key, config).includes(second.values[0]),
      );
    }
  });

  it("没登记分面的题在任何取值被选中时落选", () => {
    const bare = catalogue.filter((config) => facetsOf(config).length === 0);
    const group = groups[0];

    for (const config of bare) {
      expect(
        matchesFacets(config, { [group.key]: [group.values[0]] }),
        config.slug,
      ).toBe(false);
    }
  });

  it("认不出的维度谁也匹配不上", () => {
    for (const config of catalogue) {
      expect(matchesFacets(config, { "no-such-dimension": ["x"] })).toBe(false);
    }
  });
});

describe("facetCounts", () => {
  const bare = facetCounts(catalogue, groups, {});

  it("什么都没选时，计数就是带着这个取值的题数", () => {
    for (const group of groups) {
      for (const value of group.values) {
        expect(
          bare.get(group.key)?.get(value),
          `${group.key}=${value}`,
        ).toBe(carriers(group.key, value).length);
      }
    }
  });

  it("同一维度里已经选中的取值不压低同伴的计数", () => {
    const group = groups.find((one) => one.values.length > 1)!;
    const picked = facetCounts(catalogue, groups, {
      [group.key]: [group.values[0]],
    });

    expect(picked.get(group.key)).toEqual(bare.get(group.key));
  });

  it("别的维度一收窄，计数跟着变小", () => {
    const [first, second] = groups;
    const rarest = [...second.values].sort(
      (a, b) =>
        carriers(second.key, a).length - carriers(second.key, b).length,
    )[0];

    const total = (counts: Map<string, number> | undefined) =>
      [...(counts?.values() ?? [])].reduce((sum, one) => sum + one, 0);

    expect(
      total(
        facetCounts(catalogue, groups, { [second.key]: [rarest] }).get(
          first.key,
        ),
      ),
    ).toBeLessThan(total(bare.get(first.key)));
  });

  it("算出 0 的取值再选上确实什么都不剩", () => {
    const [first, second] = groups;
    const selection = { [first.key]: [first.values[0]] };
    const counts = facetCounts(catalogue, groups, selection).get(second.key)!;

    const dead = second.values.filter((value) => counts.get(value) === 0);
    expect(dead.length, "夹具里没有会算出 0 的组合").toBeGreaterThan(0);

    for (const value of dead) {
      expect(
        catalogue.filter((config) =>
          matchesFacets(config, { ...selection, [second.key]: [value] }),
        ),
        `${second.key}=${value}`,
      ).toEqual([]);
    }
  });
});

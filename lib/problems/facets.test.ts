import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import {
  chipValues,
  collectFacets,
  facetCounts,
  facetsFor,
  matchesFacets,
} from "./facets";
import { allProblems } from "./registry";
import { toPublicConfig, type ProblemConfig } from "./types";
import { viewsFor } from "./views";

const catalogue = allProblems();

/** Every dimension any problem declares, in the order they first appear. */
const OFFERED = [
  ...new Set(
    catalogue
      .flatMap(
        (config) => viewsFor(config.slug).facets?.(toPublicConfig(config)) ?? [],
      )
      .map((facet) => facet.key),
  ),
];

const groups = collectFacets(catalogue, OFFERED);

function valuesOn(key: string, config: ProblemConfig): string[] {
  return facetsFor(config, OFFERED).flatMap((facet) =>
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
    .flatMap((config) => facetsFor(config, OFFERED))
    .find((facet) => facet.key === key && facet.order)?.order;
}

function appearanceIn(key: string): string[] {
  return [...new Set(catalogue.flatMap((config) => valuesOn(key, config)))];
}

describe("facetsFor", () => {
  it("没有比赛提供维度时，谁都拿不到分面", () => {
    for (const config of catalogue) {
      expect(facetsFor(config, []), config.slug).toEqual([]);
    }
  });

  it("只交出比赛点名的那几维，比赛没点名的一概不露", () => {
    const one = OFFERED[0];

    for (const config of catalogue) {
      expect(
        facetsFor(config, [one]).map((facet) => facet.key),
        config.slug,
      ).toEqual(valuesOn(one, config).length > 0 ? [one] : []);
    }
  });

  it("按比赛点名的先后排，而不是按题目声明的先后", () => {
    const carrier = catalogue.find(
      (config) => facetsFor(config, OFFERED).length > 1,
    );
    expect(carrier, "夹具里没有同时占着两维的题").toBeDefined();

    const reversed = [...OFFERED].reverse();
    const keys = facetsFor(carrier!, reversed).map((facet) => facet.key);

    expect(keys).toEqual(reversed.filter((key) => keys.includes(key)));
    expect(
      keys,
      "题目声明的先后就是倒序，排没排看不出来",
    ).not.toEqual(facetsFor(carrier!, OFFERED).map((facet) => facet.key));
  });

  it("题目在某一维上没有取值时那一维整个掉出去，而不是交出空清单", () => {
    for (const config of catalogue) {
      for (const facet of facetsFor(config, OFFERED)) {
        expect(facet.values.length, `${config.slug}/${facet.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("没登记分面的题拿到空清单，而不是抛错", () => {
    expect(
      catalogue.filter((config) => facetsFor(config, OFFERED).length === 0)
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("collectFacets", () => {
  it("比赛什么都没点名时一行都不给", () => {
    expect(collectFacets(catalogue, [])).toEqual([]);
  });

  it("维度按比赛点名的先后排列", () => {
    const shown = new Set(groups.map((group) => group.key));
    expect(groups.map((group) => group.key)).toEqual(
      OFFERED.filter((key) => shown.has(key)),
    );

    const reversed = [...OFFERED].reverse();
    expect(
      collectFacets(catalogue, reversed).map((group) => group.key),
      "反过来点名，行的顺序没跟着反过来",
    ).toEqual(reversed.filter((key) => shown.has(key)));
  });

  it("谁都没有取值的维度不出现，否则筛选栏上是一行空标题", () => {
    expect(
      OFFERED.length - groups.length,
      "夹具点名的维度全都有题占着，「空的那一维不出现」就没被验证",
    ).toBeGreaterThan(0);

    for (const group of groups) {
      expect(group.values.length, group.key).toBeGreaterThan(0);
    }
  });

  it("声明过顺序的维度照声明排，声明里没有的取值缀在后面", () => {
    const group = groups.find((one) => declaredOrder(one.key));
    expect(group, "夹具里没有声明过顺序的维度").toBeDefined();

    const order = declaredOrder(group!.key)!;
    const known = group!.values.filter((value) => order.includes(value));
    const rest = group!.values.filter((value) => !order.includes(value));

    expect(known).toEqual(order.filter((value) => group!.values.includes(value)));
    expect(group!.values, "声明里没有的取值插进了声明的取值之间").toEqual([
      ...known,
      ...rest,
    ]);
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
      expect(run).toEqual([...run].sort((a, b) => a.localeCompare(b, site.lang)));
      expect(
        run,
        "夹具交出并列的取值时本来就是语言序，排没排看不出来",
      ).not.toEqual(appearance.filter((value) => run.includes(value)));
    }
  });

  it("声明过顺序的维度标成 ordered", () => {
    const ordered = groups.filter((group) => declaredOrder(group.key));
    const free = groups.filter((group) => !declaredOrder(group.key));

    expect(ordered.length, "夹具里没有声明过顺序的维度").toBeGreaterThan(0);
    expect(free.length, "夹具里没有未声明顺序的维度").toBeGreaterThan(0);

    for (const group of ordered) expect(group.ordered, group.key).toBe(true);
    for (const group of free) expect(group.ordered, group.key).toBe(false);
  });
});

describe("chipValues", () => {
  it("只取未声明顺序的维度，阶梯不进卡片 chips", () => {
    const chips = chipValues(groups);
    const free = groups
      .filter((group) => !group.ordered)
      .flatMap((group) => group.values);
    const ladder = groups
      .filter((group) => group.ordered)
      .flatMap((group) => group.values);

    expect(free.length, "夹具里没有未声明顺序的取值").toBeGreaterThan(0);
    expect(ladder.length, "夹具里没有阶梯取值").toBeGreaterThan(0);
    expect(chips).toEqual(free);
    for (const value of ladder) expect(chips).not.toContain(value);
  });
});

describe("matchesFacets", () => {
  const empty = Object.fromEntries(groups.map((group) => [group.key, []]));

  it("什么都没选就放行一切", () => {
    for (const config of catalogue) {
      expect(matchesFacets(config, OFFERED, {}), config.slug).toBe(true);
      expect(matchesFacets(config, OFFERED, empty), config.slug).toBe(true);
    }
  });

  it("一个维度里选多个取值是「任一即可」", () => {
    const group = groups.find((one) => one.values.length > 1)!;
    const [first, second] = group.values;

    const either = catalogue
      .filter((config) =>
        matchesFacets(config, OFFERED, { [group.key]: [first, second] }),
      )
      .map((config) => config.slug);

    expect(either.sort()).toEqual(
      [
        ...new Set([
          ...carriers(group.key, first),
          ...carriers(group.key, second),
        ]),
      ].sort(),
    );
  });

  it("跨维度是「都要满足」", () => {
    const [first, second] = groups;
    const selection = {
      [first.key]: [first.values[0]],
      [second.key]: [second.values[0]],
    };

    for (const config of catalogue) {
      expect(matchesFacets(config, OFFERED, selection), config.slug).toBe(
        valuesOn(first.key, config).includes(first.values[0]) &&
          valuesOn(second.key, config).includes(second.values[0]),
      );
    }
  });

  it("没登记分面的题在任何取值被选中时落选", () => {
    const bare = catalogue.filter(
      (config) => facetsFor(config, OFFERED).length === 0,
    );
    const group = groups[0];

    for (const config of bare) {
      expect(
        matchesFacets(config, OFFERED, { [group.key]: [group.values[0]] }),
        config.slug,
      ).toBe(false);
    }
  });

  it("比赛没点名的维度谁也匹配不上，即使题目在它上面有取值", () => {
    const dropped = OFFERED.find((key) => key !== groups[0].key)!;
    const value = appearanceIn(dropped)[0];
    expect(value, "夹具里没有第二个有取值的维度").toBeDefined();

    for (const config of catalogue) {
      expect(matchesFacets(config, [groups[0].key], { [dropped]: [value] })).toBe(
        false,
      );
    }
  });

  it("认不出的维度谁也匹配不上", () => {
    for (const config of catalogue) {
      expect(matchesFacets(config, OFFERED, { "no-such-dimension": ["x"] })).toBe(
        false,
      );
    }
  });
});

describe("facetCounts", () => {
  const bare = facetCounts(catalogue, OFFERED, groups, {});

  it("什么都没选时，计数就是带着这个取值的题数", () => {
    for (const group of groups) {
      for (const value of group.values) {
        expect(bare.get(group.key)?.get(value), `${group.key}=${value}`).toBe(
          carriers(group.key, value).length,
        );
      }
    }
  });

  it("同一维度里已经选中的取值不压低同伴的计数", () => {
    const group = groups.find((one) => one.values.length > 1)!;
    const picked = facetCounts(catalogue, OFFERED, groups, {
      [group.key]: [group.values[0]],
    });

    expect(picked.get(group.key)).toEqual(bare.get(group.key));
  });

  it("别的维度一收窄，计数跟着变小", () => {
    const [first, second] = groups;
    const rarest = [...second.values].sort(
      (a, b) => carriers(second.key, a).length - carriers(second.key, b).length,
    )[0];

    const total = (counts: Map<string, number> | undefined) =>
      [...(counts?.values() ?? [])].reduce((sum, one) => sum + one, 0);

    expect(
      total(
        facetCounts(catalogue, OFFERED, groups, {
          [second.key]: [rarest],
        }).get(first.key),
      ),
    ).toBeLessThan(total(bare.get(first.key)));
  });

  it("算出 0 的取值再选上确实什么都不剩", () => {
    const [first, second] = groups;
    const selection = { [first.key]: [first.values[0]] };
    const counts = facetCounts(catalogue, OFFERED, groups, selection).get(
      second.key,
    )!;

    const dead = second.values.filter((value) => counts.get(value) === 0);
    expect(dead.length, "夹具里没有会算出 0 的组合").toBeGreaterThan(0);

    for (const value of dead) {
      expect(
        catalogue.filter((config) =>
          matchesFacets(config, OFFERED, {
            ...selection,
            [second.key]: [value],
          }),
        ),
        `${second.key}=${value}`,
      ).toEqual([]);
    }
  });
});

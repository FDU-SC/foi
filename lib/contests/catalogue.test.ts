import { describe, expect, it, vi } from "vitest";
import {
  catalogueRedirect,
  catalogueSlug,
  contestHref,
  isCatalogue,
  problemHref,
  standingsHref,
} from "./catalogue";
import { contestProblemRefs } from "./refs";
import { allContests, catalogueContest } from "./registry";

const mounted = catalogueSlug();

const CATALOGUE = "/problems";
const CONTESTS = "/contests";

describe("题库的挂载点", () => {
  it("夹具指名了一场比赛，否则下面每一条都是空真", () => {
    expect(mounted, "夹具的 site.catalogue 是空的").toBeDefined();
    expect(catalogueContest()?.slug).toBe(mounted);
  });

  it("被指名的那场比赛答在 /problems，其余答在 /contests", () => {
    const others = allContests().filter(
      (contest) => !isCatalogue(contest.slug),
    );
    expect(others.length, "夹具里只有题库一场比赛，分叉的另一边没测到").toBeGreaterThan(0);

    expect(contestHref(mounted!)).toBe(CATALOGUE);
    expect(standingsHref(mounted!)).toBe(`${CATALOGUE}/standings`);

    for (const contest of others) {
      expect(contestHref(contest.slug)).toBe(`${CONTESTS}/${contest.slug}`);
      expect(standingsHref(contest.slug)).toBe(
        `${CONTESTS}/${contest.slug}/standings`,
      );
    }
  });

  it("题库带的每道题都答在 /problems 下，其余的都在 /contests 下", () => {
    const inside = contestProblemRefs().filter((ref) =>
      isCatalogue(ref.contest.slug),
    );
    const outside = contestProblemRefs().filter(
      (ref) => !isCatalogue(ref.contest.slug),
    );

    expect(inside.length, "题库没带题").toBeGreaterThan(0);
    expect(outside.length, "题库之外没有题").toBeGreaterThan(0);

    for (const ref of inside) {
      expect(problemHref(ref.contest.slug, ref.problem.slug)).toBe(
        `${CATALOGUE}/${ref.problem.slug}`,
      );
    }
    for (const ref of outside) {
      expect(problemHref(ref.contest.slug, ref.problem.slug)).toBe(
        `${CONTESTS}/${ref.contest.slug}/problems/${ref.problem.slug}`,
      );
    }
  });

  it("每一对 (比赛, 题目) 只有一个地址，同一道题在两场比赛里也是两个", () => {
    const urls = contestProblemRefs().map((ref) =>
      problemHref(ref.contest.slug, ref.problem.slug),
    );

    expect(new Set(urls).size, "有两对指向了同一个地址").toBe(urls.length);
  });

  it("换了挂载点的那场比赛，不在 /contests 下留任何地址", () => {
    const stale = contestProblemRefs()
      .filter((ref) => isCatalogue(ref.contest.slug))
      .map((ref) => problemHref(ref.contest.slug, ref.problem.slug))
      .filter((url) => url.startsWith(`${CONTESTS}/`));

    expect(stale).toEqual([]);
  });
});

describe("题库在 /contests 下的旧地址", () => {
  const old = `${CONTESTS}/${mounted}`;

  it("每一个都指向它搬去的地方", () => {
    expect(catalogueRedirect(old)).toBe(CATALOGUE);
    expect(catalogueRedirect(`${old}/standings`)).toBe(`${CATALOGUE}/standings`);
    expect(catalogueRedirect(`${old}/problems/some-problem`)).toBe(
      `${CATALOGUE}/some-problem`,
    );
  });

  it("题库带的每道题，旧地址都落回它现在唯一的那个地址", () => {
    for (const ref of contestProblemRefs()) {
      if (!isCatalogue(ref.contest.slug)) continue;

      expect(
        catalogueRedirect(
          `${CONTESTS}/${ref.contest.slug}/problems/${ref.problem.slug}`,
        ),
      ).toBe(problemHref(ref.contest.slug, ref.problem.slug));
    }
  });

  it("前缀下认不出的路径回题库首页，不放任何一条漏过去", () => {
    expect(catalogueRedirect(`${old}/whatever`)).toBe(CATALOGUE);
    expect(catalogueRedirect(`${old}/problems/a/b`)).toBe(CATALOGUE);
  });

  it("别的比赛一个都不碰，前缀相同的也不碰", () => {
    for (const contest of allContests()) {
      if (isCatalogue(contest.slug)) continue;

      expect(catalogueRedirect(`${CONTESTS}/${contest.slug}`)).toBeNull();
      expect(
        catalogueRedirect(`${CONTESTS}/${contest.slug}/standings`),
      ).toBeNull();
    }

    expect(catalogueRedirect(`${old}-extra`)).toBeNull();
    expect(catalogueRedirect(CONTESTS)).toBeNull();
    expect(catalogueRedirect(CATALOGUE)).toBeNull();
  });
});

describe("没有指名题库时", () => {
  it("每场比赛都留在 /contests 下", async () => {
    vi.resetModules();
    vi.doMock("@/content/site", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/content/site")>();
      return { site: { ...actual.site, catalogue: undefined } };
    });

    try {
      const fresh = await import("./catalogue");

      expect(fresh.catalogueSlug()).toBeUndefined();
      expect(fresh.isCatalogue(mounted!)).toBe(false);

      expect(fresh.problemHref(mounted!, "any")).toBe(
        `${CONTESTS}/${mounted}/problems/any`,
      );
      expect(fresh.contestHref(mounted!)).toBe(`${CONTESTS}/${mounted}`);
      expect(fresh.standingsHref(mounted!)).toBe(
        `${CONTESTS}/${mounted}/standings`,
      );
      expect(fresh.catalogueRedirect(`${CONTESTS}/${mounted}`)).toBeNull();
    } finally {
      vi.doUnmock("@/content/site");
      vi.resetModules();
    }
  });
});

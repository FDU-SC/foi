import { describe, expect, it, vi } from "vitest";
import {
  catalogueHref,
  catalogueRedirect,
  catalogueSlugs,
  contestHref,
  isCatalogue,
  problemHref,
  standingsHref,
} from "./catalogue";
import { contestProblemRefs } from "./refs";
import { allContests, catalogueContests } from "./registry";

const mounted = catalogueSlugs();

const CATALOGUE = "/problems";
const CONTESTS = "/contests";

describe("题库的挂载点", () => {
  it("夹具指名了几场比赛，否则下面每一条都是空真", () => {
    expect(mounted.length, "夹具的 site.catalogue 是空的").toBeGreaterThan(1);
    expect(catalogueContests().map((contest) => contest.slug)).toEqual(mounted);
  });

  it("被指名的那几场答在 /problems 下，其余答在 /contests 下", () => {
    const others = allContests().filter(
      (contest) => !isCatalogue(contest.slug),
    );
    expect(others.length, "夹具里全是题库比赛，分叉的另一边没测到").toBeGreaterThan(0);

    for (const slug of mounted) {
      expect(contestHref(slug)).toBe(`${CATALOGUE}/${slug}`);
      expect(standingsHref(slug)).toBe(`${CATALOGUE}/${slug}/standings`);
    }

    for (const contest of others) {
      expect(contestHref(contest.slug)).toBe(`${CONTESTS}/${contest.slug}`);
      expect(standingsHref(contest.slug)).toBe(
        `${CONTESTS}/${contest.slug}/standings`,
      );
    }
  });

  it("索引在 /problems，每张卡片都从这里下去", () => {
    expect(catalogueHref()).toBe(CATALOGUE);
    for (const slug of mounted) {
      expect(contestHref(slug).startsWith(`${CATALOGUE}/`)).toBe(true);
    }
  });

  it("题库带的每道题都答在自己分区下，其余的都在 /contests 下", () => {
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
        `${CATALOGUE}/${ref.contest.slug}/${ref.problem.slug}`,
      );
    }
    for (const ref of outside) {
      expect(problemHref(ref.contest.slug, ref.problem.slug)).toBe(
        `${CONTESTS}/${ref.contest.slug}/problems/${ref.problem.slug}`,
      );
    }
  });

  it("每一对 (比赛, 题目) 只有一个地址，同一道题在两个分区里也是两个", () => {
    const urls = contestProblemRefs().map((ref) =>
      problemHref(ref.contest.slug, ref.problem.slug),
    );

    const shared = contestProblemRefs()
      .filter((ref) => isCatalogue(ref.contest.slug))
      .map((ref) => ref.problem.slug);
    expect(
      shared.length - new Set(shared).size,
      "题库里没有一道题被两个分区带着，「一题两址」没被验证",
    ).toBeGreaterThan(0);

    expect(new Set(urls).size, "有两对指向了同一个地址").toBe(urls.length);
  });

  it("换了挂载点的那几场，不在 /contests 下留任何地址", () => {
    const stale = contestProblemRefs()
      .filter((ref) => isCatalogue(ref.contest.slug))
      .map((ref) => problemHref(ref.contest.slug, ref.problem.slug))
      .filter((url) => url.startsWith(`${CONTESTS}/`));

    expect(stale).toEqual([]);
  });
});

describe("题库在 /contests 下的旧地址", () => {
  it("每一个都指向它搬去的地方，比赛 slug 一路带着", () => {
    for (const slug of mounted) {
      const old = `${CONTESTS}/${slug}`;

      expect(catalogueRedirect(old)).toBe(`${CATALOGUE}/${slug}`);
      expect(catalogueRedirect(`${old}/standings`)).toBe(
        `${CATALOGUE}/${slug}/standings`,
      );
      expect(catalogueRedirect(`${old}/problems/some-problem`)).toBe(
        `${CATALOGUE}/${slug}/some-problem`,
      );
    }
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

  it("前缀下认不出的路径回那个分区，不放任何一条漏过去", () => {
    const old = `${CONTESTS}/${mounted[0]}`;

    expect(catalogueRedirect(`${old}/whatever`)).toBe(
      `${CATALOGUE}/${mounted[0]}`,
    );
    expect(catalogueRedirect(`${old}/problems/a/b`)).toBe(
      `${CATALOGUE}/${mounted[0]}`,
    );
  });

  it("别的比赛一个都不碰，前缀相同的也不碰", () => {
    for (const contest of allContests()) {
      if (isCatalogue(contest.slug)) continue;

      expect(catalogueRedirect(`${CONTESTS}/${contest.slug}`)).toBeNull();
      expect(
        catalogueRedirect(`${CONTESTS}/${contest.slug}/standings`),
      ).toBeNull();
    }

    expect(catalogueRedirect(`${CONTESTS}/${mounted[0]}-extra`)).toBeNull();
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
      const slug = mounted[0];

      expect(fresh.catalogueSlugs()).toEqual([]);
      expect(fresh.isCatalogue(slug)).toBe(false);

      expect(fresh.problemHref(slug, "any")).toBe(
        `${CONTESTS}/${slug}/problems/any`,
      );
      expect(fresh.contestHref(slug)).toBe(`${CONTESTS}/${slug}`);
      expect(fresh.standingsHref(slug)).toBe(`${CONTESTS}/${slug}/standings`);
      expect(fresh.catalogueRedirect(`${CONTESTS}/${slug}`)).toBeNull();
    } finally {
      vi.doUnmock("@/content/site");
      vi.resetModules();
    }
  });
});

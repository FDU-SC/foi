import { describe, expect, it, vi } from "vitest";
import { STANDINGS_SEGMENT } from "./catalogue";
import { allContests } from "./registry";
import type { ContestConfig } from "./types";
import { catalogueComplaints, catalogueWarnings } from "./warnings";

const ABSENT = "no-such-contest";

interface Stub {
  /** What `site.catalogue` names. */
  slugs: string[];

  /** Which of those the registry actually holds. */
  contests: ContestConfig[];
}

/**
 * Loads the boot checks against a stand-in catalogue. Faking the accessors
 * rather than the registry keeps the shapes real: the registry refuses
 * malformed contests at load, which is what these checks sit downstream of.
 */
async function checksWith(
  stub: Stub,
): Promise<{ complaints: string[]; warnings: string[] }> {
  const held = new Map(stub.contests.map((contest) => [contest.slug, contest]));

  vi.resetModules();
  vi.doMock("./catalogue", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./catalogue")>()),
    catalogueSlugs: () => stub.slugs,
  }));
  vi.doMock("./registry", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./registry")>()),
    catalogueContests: () => stub.contests,
    contestBySlug: (slug: string) => held.get(slug),
  }));

  try {
    const fresh = await import("./warnings");
    return {
      complaints: fresh.catalogueComplaints(),
      warnings: fresh.catalogueWarnings(),
    };
  } finally {
    vi.doUnmock("./catalogue");
    vi.doUnmock("./registry");
    vi.resetModules();
  }
}

/** A contest shaped like a real one, carrying whatever problem set is asked for. */
function carrying(slug: string, problemSlug: string): ContestConfig {
  return {
    ...allContests()[0]!,
    slug,
    problems: [{ slug: problemSlug, label: "A" }],
  };
}

describe("题库的启动校验", () => {
  it("这套 content 自己是干净的", () => {
    expect(catalogueComplaints()).toEqual([]);
    expect(catalogueWarnings()).toEqual([]);
  });

  it("没指名题库时无话可说", async () => {
    expect(await checksWith({ slugs: [], contests: [] })).toEqual({
      complaints: [],
      warnings: [],
    });
  });

  it("指名了不存在的比赛只是警告：那些分区会 404，别的照旧", async () => {
    const present = allContests()[0]!;
    const { complaints, warnings } = await checksWith({
      slugs: [present.slug, ABSENT],
      contests: [present],
    });

    expect(complaints, "抽空 content 的构建会因此起不来").toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(ABSENT);
    expect(warnings[0], "在场的那一场不该被点名").not.toContain(present.slug);
  });

  it("题库题单里的题会被排行榜页挡住时拒绝启动", async () => {
    const shadowed = carrying("shadowed-section", STANDINGS_SEGMENT);
    const { complaints, warnings } = await checksWith({
      slugs: [shadowed.slug],
      contests: [shadowed],
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(STANDINGS_SEGMENT);
    expect(complaints[0], "拒绝要指出是哪个分区").toContain(shadowed.slug);
    expect(warnings).toEqual([]);
  });

  it("每个分区各查各的，一场被挡住不牵连别的", async () => {
    const clean = carrying("clean-section", "some-problem");
    const shadowed = carrying("shadowed-section", STANDINGS_SEGMENT);

    const { complaints } = await checksWith({
      slugs: [clean.slug, shadowed.slug],
      contests: [clean, shadowed],
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(shadowed.slug);
  });

  it("题单里没有那个 slug 就放行", async () => {
    const base = allContests()[0]!;

    expect(
      await checksWith({ slugs: [base.slug], contests: [base] }),
    ).toEqual({ complaints: [], warnings: [] });
  });
});

import { describe, expect, it, vi } from "vitest";
import { STANDINGS_SEGMENT } from "./catalogue";
import { allContests } from "./registry";
import type { ContestConfig } from "./types";
import { catalogueComplaints, catalogueWarnings } from "./warnings";

const ABSENT = "no-such-contest";

interface Stub {
  slug: string | undefined;
  contest: ContestConfig | undefined;
}

/**
 * Loads the boot checks against a stand-in catalogue. Faking the accessors
 * rather than the registry keeps the shapes real: the registry refuses
 * malformed contests at load, which is what these checks sit downstream of.
 */
async function checksWith(
  stub: Stub,
): Promise<{ complaints: string[]; warnings: string[] }> {
  vi.resetModules();
  vi.doMock("./catalogue", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./catalogue")>()),
    catalogueSlug: () => stub.slug,
  }));
  vi.doMock("./registry", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./registry")>()),
    catalogueContest: () => stub.contest,
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

describe("题库的启动校验", () => {
  it("这套 content 自己是干净的", () => {
    expect(catalogueComplaints()).toEqual([]);
    expect(catalogueWarnings()).toEqual([]);
  });

  it("没指名题库时无话可说", async () => {
    expect(await checksWith({ slug: undefined, contest: undefined })).toEqual({
      complaints: [],
      warnings: [],
    });
  });

  it("指名了一场不存在的比赛只是警告：/problems 会 404，别的照旧", async () => {
    const { complaints, warnings } = await checksWith({
      slug: ABSENT,
      contest: undefined,
    });

    expect(complaints, "抽空 content 的构建会因此起不来").toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(ABSENT);
  });

  it("题库题单里的题会被排行榜页挡住时拒绝启动", async () => {
    const base = allContests()[0]!;
    const { complaints, warnings } = await checksWith({
      slug: base.slug,
      contest: { ...base, problems: [{ slug: STANDINGS_SEGMENT, label: "A" }] },
    });

    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(STANDINGS_SEGMENT);
    expect(warnings).toEqual([]);
  });

  it("题单里没有那个 slug 就放行", async () => {
    const base = allContests()[0]!;

    expect(await checksWith({ slug: base.slug, contest: base })).toEqual({
      complaints: [],
      warnings: [],
    });
  });
});

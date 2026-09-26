import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueBoardSections,
  catalogueLeaderboards,
  catalogueSlugs,
} from "@/lib/contests/catalogue";
import { PAGE_SIZE } from "@/lib/paging";
import { catalogueStandingsFor, type CatalogueStandings } from "@/lib/standings/compute";
import { assignRanks } from "@/lib/standings/types";
import { LeaderboardView } from "./leaderboard";

vi.mock("@/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/authz/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz/engine")>()),
  allows: vi.fn(),
}));
vi.mock("@/lib/standings/compute", () => ({ catalogueStandingsFor: vi.fn() }));
vi.mock("@/lib/contests/catalogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contests/catalogue")>();
  return {
    ...actual,
    catalogueLeaderboards: vi.fn(actual.catalogueLeaderboards),
    catalogueBoardSections: vi.fn(actual.catalogueBoardSections),
  };
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
  notFound: () => { throw new Error("not-found"); },
}));

const USER = { uid: 55, username: "me", nickname: "Me", avatarUpdatedAt: null, groups: [] };
const BOARD = { id: "direction", title: "方向", sections: [] as string[], includeInTotal: true };

function standings(count: number): CatalogueStandings {
  const rows = assignRanks(Array.from({ length: count }, (_, index) => ({
    participant: { uid: index + 1, nickname: `Player ${index + 1}`, username: `user${index + 1}` },
    total: count - index,
    tiebreak: 0,
    cells: {},
  })));
  return {
    sections: [],
    problems: [],
    frozen: false,
    board: {
      leaderboard: { id: "main", title: "总分榜", ruleset: { id: "tally" } },
      ruleset: { id: "tally", name: "计分", description: "", compute: () => ({ rows: [], totalLabel: "" }) },
      renderers: {},
      standings: { rows, totalLabel: "总分" },
    },
  };
}

function view(searchParams: Record<string, string | string[]> = {}) {
  return LeaderboardView({ searchParams: Promise.resolve(searchParams) });
}

/** Catalogued sections a viewer can read, which is what the section filter offers. */
function readable() {
  return catalogueSlugs().filter((slug) => contestFor(slug, ANONYMOUS));
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockResolvedValue(USER);
  vi.mocked(allows).mockReturnValue(true);
  vi.mocked(catalogueStandingsFor).mockResolvedValue(standings(PAGE_SIZE + 10));
});
afterEach(() => vi.resetAllMocks());

describe("题库排行榜的访问", () => {
  it("游客跳转登录，保留完整的筛选参数", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(view()).rejects.toThrow("/login?next=%2Fleaderboard");
    await expect(view({ period: "7d", q: "a b" })).rejects.toThrow(
      `/login?next=${encodeURIComponent("/leaderboard?period=7d&q=a+b")}`,
    );
  });

  it("未知或重复的方向参数在登录前返回 404", async () => {
    vi.mocked(catalogueLeaderboards).mockReturnValue([BOARD]);
    vi.mocked(getSessionUser).mockResolvedValue(null);
    for (const board of ["missing", ["direction", "direction"]]) {
      await expect(view({ board })).rejects.toThrow("not-found");
    }
    await expect(view({ board: "direction" })).rejects.toThrow(
      `/login?next=${encodeURIComponent("/leaderboard?board=direction")}`,
    );
  });

  it("未授权或没有可算的题库时返回 404", async () => {
    vi.mocked(allows).mockReturnValue(false);
    await expect(view()).rejects.toThrow("not-found");
    expect(catalogueStandingsFor).not.toHaveBeenCalled();

    vi.mocked(allows).mockReturnValue(true);
    vi.mocked(catalogueStandingsFor).mockResolvedValue(null);
    await expect(view()).rejects.toThrow("not-found");
  });
});

describe("题库排行榜的筛选", () => {
  it("分区与时间收窄计算范围，读不懂的分区被丢掉", async () => {
    const [section] = readable();
    renderToStaticMarkup(await view({ section: [section, "bogus"], period: "7d" }));

    const [[asked]] = vi.mocked(catalogueStandingsFor).mock.calls;
    expect(asked).toEqual({ board: undefined, sections: [section], days: 7 });
  });

  it("有方向榜时给出方向筛选，切换方向时清掉分区", async () => {
    const sections = readable();
    vi.mocked(catalogueLeaderboards).mockReturnValue([{ ...BOARD, sections }]);
    vi.mocked(catalogueBoardSections).mockReturnValue(sections);
    const html = renderToStaticMarkup(await view({ section: sections[0] }));

    expect(html).toContain("方向");
    expect(html).toContain('href="/leaderboard?board=direction"');
    expect(html).toContain("分区");
  });

  it("搜索保留全榜名次，我的排名来自全榜并能定位到所在页", async () => {
    const html = renderToStaticMarkup(await view({ q: "player 5" }));

    expect(html).toContain("总排行榜");
    expect(html).toContain("我的排名");
    expect(html).toContain(`#${USER.uid}`);
    expect(html).toContain('href="/leaderboard?page=2"');
    expect(html).toMatch(/>59<\/span>.*Player 59/);
    expect(html).not.toContain("Player 6<");
  });

  it("按页显示，页码链接保留其余参数", async () => {
    const html = renderToStaticMarkup(await view({ period: "30d" }));
    expect(html).toContain("Player 1<");
    expect(html).not.toContain(`Player ${PAGE_SIZE + 1}<`);
    expect(html).toContain('href="/leaderboard?period=30d&amp;page=2"');
  });
});

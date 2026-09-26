import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getSessionUser, getViewer } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { catalogueLeaderboards, catalogueSlugs } from "@/lib/contests/catalogue";
import { dayEnd, dayStart } from "@/lib/calendar-day";
import { PAGE_SIZE } from "@/lib/paging";
import { catalogueStandingsFor, type CatalogueStandings } from "@/lib/standings/compute";
import { assignRanks } from "@/lib/standings/types";
import { CatalogueShellView } from "@/views/catalogue/shell";
import { LeaderboardView } from "./leaderboard";

const navigation = vi.hoisted(() => ({ pathname: "/leaderboard", search: "" }));
vi.mock("@/auth", () => ({ getSessionUser: vi.fn(), getViewer: vi.fn() }));
vi.mock("@/lib/authz/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz/engine")>()),
  allows: vi.fn(),
}));
vi.mock("@/lib/standings/compute", () => ({ catalogueStandingsFor: vi.fn() }));
vi.mock("@/lib/problems/progress", () => ({ progressFor: vi.fn(async () => new Map()) }));
vi.mock("@/lib/contests/catalogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contests/catalogue")>();
  return {
    ...actual,
    catalogueLeaderboards: vi.fn(actual.catalogueLeaderboards),
  };
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
  notFound: () => { throw new Error("not-found"); },
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
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

async function view(searchParams: Record<string, string | string[]> = {}) {
  navigation.pathname = "/leaderboard";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }
  navigation.search = query.toString();
  const panel = await LeaderboardView({ searchParams: Promise.resolve(searchParams) });
  return CatalogueShellView({ children: panel });
}

/** Catalogued sections a viewer can read, which is what the section filter offers. */
function readable() {
  return catalogueSlugs().filter((slug) => contestFor(slug, ANONYMOUS));
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockResolvedValue(USER);
  vi.mocked(getViewer).mockResolvedValue(viewerFor(USER));
  vi.mocked(allows).mockReturnValue(true);
  vi.mocked(catalogueStandingsFor).mockResolvedValue(standings(PAGE_SIZE + 10));
});
afterEach(() => vi.resetAllMocks());

describe("题库排行榜的访问", () => {
  it("游客跳转登录，保留完整的筛选参数", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(view()).rejects.toThrow("/login?next=%2Fleaderboard");
    await expect(view({ from: "2026-09-01", q: "a b" })).rejects.toThrow(
      `/login?next=${encodeURIComponent("/leaderboard?from=2026-09-01&q=a+b")}`,
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
    renderToStaticMarkup(await view({ section: [section, "bogus"], from: "2026-09-01", to: "2026-09-20" }));

    const [[asked]] = vi.mocked(catalogueStandingsFor).mock.calls;
    expect(asked).toEqual({
      board: undefined,
      sections: [section],
      from: dayStart("2026-09-01"),
      until: dayEnd("2026-09-20"),
    });
  });

  it("时间用一个日历选范围，填反的对调，读不懂的丢掉且不被链接带着", async () => {
    const html = renderToStaticMarkup(await view({ from: "2026-09-20", to: "2026-09-01", q: "k" }));
    const [[asked]] = vi.mocked(catalogueStandingsFor).mock.calls;
    expect(asked).toMatchObject({ from: dayStart("2026-09-01"), until: dayEnd("2026-09-20") });
    expect(html).toContain("2026/09/01 – 2026/09/20");

    vi.mocked(catalogueStandingsFor).mockClear();
    const junk = renderToStaticMarkup(await view({ from: "2026-02-30", to: "", q: "k" }));
    const [[unread]] = vi.mocked(catalogueStandingsFor).mock.calls;
    expect(unread).toMatchObject({ from: undefined, until: undefined });
    expect(junk).not.toContain("2026-02-30");
    expect(junk).not.toContain("to=");
  });

  it("左栏与题单页相同，按方向分组；选中的范围高亮，切换时保留时间与搜索并回到第一页", async () => {
    const byDomain = [...Map.groupBy(readable(), (slug) => contestFor(slug, ANONYMOUS)!.config.domain)];
    const [heading, gathered] = byDomain.find(([domain, slugs]) => domain !== undefined && slugs.length > 1)!;
    const [first] = gathered;
    const html = renderToStaticMarkup(await view({ section: first, from: "2026-09-01", q: "k", page: "2" }));
    const keep = "q=k&amp;from=2026-09-01";
    const all = [...gathered].sort().map((slug) => `section=${slug}`).join("&amp;");

    expect(html).toContain('aria-label="题单"');
    expect(html, "方向标题只作分组").toContain(`>${heading}</p>`);
    expect(html).toMatch(new RegExp(`href="/leaderboard\\?${keep}"[^>]*>[\\s\\S]*?全部题目`));
    expect(html, "方向的「全部」排它的所有分区").toContain(`href="/leaderboard?${keep}&amp;${all}"`);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="/leaderboard\\?${keep}&amp;section=${first}"`));
    expect(html.match(/aria-current="page"/g), "当前范围与当前 tab 各一个").toHaveLength(2);
  });

  it("排行榜与题目是同一页面的两个 tab，题目 tab 打开同一范围的题单", async () => {
    const byDomain = [...Map.groupBy(readable(), (slug) => contestFor(slug, ANONYMOUS)!.config.domain)];
    const [heading, gathered] = byDomain.find(([domain, slugs]) => domain !== undefined && slugs.length > 1)!;
    const tab = (html: string) => /href="([^"]*)"[^>]*>题目<\/a>/.exec(html)?.[1].replaceAll("&amp;", "&");

    const whole = renderToStaticMarkup(await view({ section: gathered }));
    expect(whole).toContain(">题库</h1>");
    expect(whole).toMatch(/aria-current="page"[^>]*>排行榜<\/a>/);
    expect(tab(whole)).toBe(`/problems?${new URLSearchParams({ domain: heading! })}`);

    expect(tab(renderToStaticMarkup(await view({ section: gathered[0] })))).toBe(`/problems/${gathered[0]}`);
    expect(tab(renderToStaticMarkup(await view({})))).toBe("/problems");
  });

  it("搜索保留全榜名次，我的排名来自全榜并能定位到所在页", async () => {
    const html = renderToStaticMarkup(await view({ q: "player 5" }));

    expect(html).toContain(">题库</h1>");
    expect(html, "标题旁不显示计分规则名").not.toContain("计分");
    expect(html).toContain("我的排名");
    expect(html).toContain(`#${USER.uid}`);
    expect(html).toContain('href="/leaderboard?page=2"');
    expect(html).toMatch(/>59<\/span>.*Player 59/);
    expect(html).not.toContain("Player 6<");
  });

  it("按页显示，页码链接保留其余参数", async () => {
    const html = renderToStaticMarkup(await view({ from: "2026-09-01" }));
    expect(html).toContain("Player 1<");
    expect(html).not.toContain(`Player ${PAGE_SIZE + 1}<`);
    expect(html).toContain('href="/leaderboard?from=2026-09-01&amp;page=2"');
  });
});

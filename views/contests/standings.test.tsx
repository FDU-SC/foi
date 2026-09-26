import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { standingsFor, type ContestStandings, type LeaderboardStandings } from "@/lib/standings/compute";
import { assignRanks } from "@/lib/standings/types";
import { openContestProblem } from "@/test/content-shapes";
import { StandingsView } from "./standings";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/standings/compute", () => ({ standingsFor: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "",
  notFound: () => { throw new Error("not-found"); },
}));

const { contest } = openContestProblem();

function board(id: string, title: string, names: string[]): LeaderboardStandings {
  return {
    leaderboard: { id, title, ruleset: { id: "tally" } },
    ruleset: { id: "tally", name: "计分", description: "", compute: () => ({ rows: [], totalLabel: "" }) },
    renderers: {},
    standings: {
      totalLabel: "通过",
      rows: assignRanks(names.map((nickname, index) => ({
        participant: { uid: index + 1, nickname },
        total: names.length - index,
        tiebreak: 0,
        cells: {},
      }))),
    },
  };
}

function standings(...boards: LeaderboardStandings[]): ContestStandings {
  return { contest, problems: [], boards, frozen: false };
}

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await StandingsView({
    params: Promise.resolve({ slug: contest.slug }),
    searchParams: Promise.resolve(searchParams),
  }));
}

beforeEach(() => {
  vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
});
afterEach(() => vi.resetAllMocks());

describe("比赛排行榜", () => {
  it("多个榜一次显示一个，用榜单筛选切换，未知的榜回到第一个", async () => {
    vi.mocked(standingsFor).mockResolvedValue(standings(
      board("main", "正式榜", ["Alpha"]),
      board("rookie", "新人榜", ["Rookie"]),
    ));

    const first = await render();
    expect(first).toContain("榜单");
    expect(first).toContain("Alpha");
    expect(first).not.toContain("Rookie");

    const second = await render({ board: "rookie" });
    expect(second, "标题不随榜单变化").toContain(">排行榜</h1>");
    expect(second, "标题旁不显示计分规则名").not.toContain("计分");
    expect(second).toContain("新人榜");
    expect(second).toContain("Rookie");
    expect(second).not.toContain("Alpha");

    expect(await render({ board: "missing" })).toContain("Alpha");
  });

  it("只有一个榜时没有榜单筛选，游客看不到我的排名", async () => {
    vi.mocked(standingsFor).mockResolvedValue(standings(board("main", "正式榜", ["Alpha", "Beta"])));
    const html = await render({ q: "beta" });

    expect(html).not.toContain("榜单");
    expect(html).not.toContain("我的排名");
    expect(html).toContain("Beta");
    expect(html).not.toContain("Alpha");
  });

  it("登录用户看到自己的名次", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewerFor({ uid: 2, groups: [] }));
    vi.mocked(standingsFor).mockResolvedValue(standings(board("main", "正式榜", ["Alpha", "Beta"])));
    const html = await render();

    expect(html).toContain("我的排名");
    expect(html).toContain("#2");
  });
});

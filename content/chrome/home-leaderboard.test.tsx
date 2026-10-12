import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { catalogueStandingsFor, type CatalogueStandings } from "@/lib/standings/compute";
import { assignRanks } from "@/lib/standings/types";
import { FoiHomeLeaderboard } from "./home-leaderboard";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/authz/engine", () => ({ allows: vi.fn() }));
vi.mock("@/lib/standings/compute", () => ({ catalogueStandingsFor: vi.fn() }));

const VIEWER = viewerFor({ uid: 7, groups: [] });

function standings(count: number): CatalogueStandings {
  const rows = assignRanks(Array.from({ length: count }, (_, index) => ({
    participant: index === 0
      ? { uid: VIEWER.uid!, nickname: "Alice", username: "alice" }
      : { uid: 100 + index, nickname: `Player ${index}`, username: `player${index}` },
    total: 1000 - index,
    tiebreak: 0,
    cells: {},
  })));
  return {
    sections: [],
    problems: [],
    frozen: false,
    board: {
      leaderboard: { id: "main", title: "总分榜", ruleset: { id: "practice" } },
      ruleset: { id: "practice", name: "练习", description: "", compute: () => ({ rows: [], totalLabel: "" }) },
      renderers: {},
      standings: { rows, totalLabel: "总分" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getViewer).mockResolvedValue(VIEWER);
  vi.mocked(allows).mockReturnValue(false);
  vi.mocked(catalogueStandingsFor).mockResolvedValue(null);
});

describe("主页排行榜", () => {
  it("游客不会触发授权判断或排行榜计算", async () => {
    vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);

    expect(await FoiHomeLeaderboard()).toBeNull();
    expect(allows).not.toHaveBeenCalled();
    expect(catalogueStandingsFor).not.toHaveBeenCalled();
  });

  it("无权查看排行榜的登录用户不会触发计算", async () => {
    expect(await FoiHomeLeaderboard()).toBeNull();
    expect(allows).toHaveBeenCalledWith("leaderboard.read", null, VIEWER);
    expect(catalogueStandingsFor).not.toHaveBeenCalled();
  });

  it("有权用户看到总榜前五并标出自己", async () => {
    vi.mocked(allows).mockReturnValue(true);
    vi.mocked(catalogueStandingsFor).mockResolvedValue(standings(8));

    const html = renderToStaticMarkup(await FoiHomeLeaderboard());

    expect(catalogueStandingsFor).toHaveBeenCalledWith({}, VIEWER);
    expect(html).toContain("Alice（我）");
    expect(html).toContain("@alice");
    expect(html).toContain("Player 4");
    expect(html).not.toContain("Player 5");
    expect(html).toContain("总分");
  });

  it("没有题库时显示空状态", async () => {
    vi.mocked(allows).mockReturnValue(true);
    const html = renderToStaticMarkup(await FoiHomeLeaderboard());
    expect(html).toContain("还没有提交记录。");
  });
});

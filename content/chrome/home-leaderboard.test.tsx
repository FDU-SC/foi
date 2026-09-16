import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { leaderboardRows, type LeaderboardRow } from "./leaderboard-data";
import { FoiHomeLeaderboard } from "./home-leaderboard";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/authz/engine", () => ({ allows: vi.fn() }));
vi.mock("./leaderboard-data", () => ({ leaderboardRows: vi.fn() }));

const VIEWER = viewerFor({ uid: 7, groups: [] });
const ROWS: LeaderboardRow[] = [
  {
    rank: 1, total: 200,
    uid: VIEWER.uid!,
    username: "alice",
    nickname: "Alice",
    submissions: 3,
    solved: 2,
    firstBloods: 1,
  },
  {
    rank: 2, total: 100,
    uid: 8,
    username: "bob",
    nickname: "Bob",
    submissions: 2,
    solved: 1,
    firstBloods: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getViewer).mockResolvedValue(VIEWER);
  vi.mocked(allows).mockReturnValue(false);
  vi.mocked(leaderboardRows).mockResolvedValue([]);
});

describe("主页排行榜", () => {
  it("游客不会触发授权判断或排行榜查询", async () => {
    vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);

    expect(await FoiHomeLeaderboard()).toBeNull();
    expect(allows).not.toHaveBeenCalled();
    expect(leaderboardRows).not.toHaveBeenCalled();
  });

  it("无权查看排行榜的登录用户不会触发查询", async () => {
    expect(await FoiHomeLeaderboard()).toBeNull();
    expect(allows).toHaveBeenCalledWith("leaderboard.read", null, VIEWER);
    expect(leaderboardRows).not.toHaveBeenCalled();
  });

  it("有权用户只查询主页所需行数并标出自己", async () => {
    vi.mocked(allows).mockReturnValue(true);
    vi.mocked(leaderboardRows).mockResolvedValue(ROWS);

    const html = renderToStaticMarkup(await FoiHomeLeaderboard());

    expect(leaderboardRows).toHaveBeenCalledWith(5);
    expect(html).toContain("Alice（我）");
    expect(html).toContain("@alice");
    expect(html).toContain("Bob");
    expect(html).not.toContain("Bob（我）");
  });
});

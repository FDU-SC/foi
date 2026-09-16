import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { catalogueLeaderboards } from "@/lib/contests/catalogue";
import { leaderboardRows } from "./leaderboard-data";
import { FoiLeaderboard } from "./leaderboard";

vi.mock("@/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/authz/engine", () => ({ allows: vi.fn() }));
vi.mock("./leaderboard-data", () => ({ leaderboardRows: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
  notFound: () => { throw new Error("not-found"); },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ uid: 1, username: "u", nickname: "用户", avatarUpdatedAt: null, groups: [] });
  vi.mocked(allows).mockReturnValue(true);
  vi.mocked(leaderboardRows).mockResolvedValue([]);
});

it("方向切换保留总榜入口，空榜展示空状态", async () => {
  const board = catalogueLeaderboards()[0];
  if (!board) return;
  const html = renderToStaticMarkup(await FoiLeaderboard({ board: board.id }));
  expect(leaderboardRows).toHaveBeenCalledWith(50, expect.any(Date), board.id);
  expect(html).toContain("总榜");
  expect(html).toContain("还没有提交记录");
  expect(html).toContain(`${board.title.replaceAll("&", "&amp;")}排行榜`);
  expect(html).toContain('aria-current="page"');
});

it("总榜展示总分与查询返回的并列名次", async () => {
  vi.mocked(leaderboardRows).mockResolvedValue([1, 2].map((uid) => ({
    uid, username: `user${uid}`, nickname: `用户${uid}`, rank: 1, total: 75.5, solved: 0, submissions: 2, firstBloods: 0,
  })));
  const html = renderToStaticMarkup(await FoiLeaderboard({}));
  expect(html).toContain("总排行榜");
  expect(html.match(/75\.5/g)).toHaveLength(2);
  expect(html).toContain("（我）");
  expect(html.match(/text-xs">1<\/td>/g)).toHaveLength(2);
});

it("无权限或未知榜单不查询提交", async () => {
  vi.mocked(allows).mockReturnValue(false);
  await expect(FoiLeaderboard({})).rejects.toThrow("not-found");
  vi.mocked(allows).mockReturnValue(true);
  await expect(FoiLeaderboard({ board: "unknown-board" })).rejects.toThrow("not-found");
  expect(leaderboardRows).not.toHaveBeenCalled();
});

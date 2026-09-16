import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { siteViews } from "@/lib/site-views";
import { LeaderboardView } from "./leaderboard";
vi.mock("@/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/authz/engine", () => ({ allows: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(path); },
  notFound: () => { throw new Error("not-found"); },
}));
afterEach(() => { delete siteViews.Leaderboard; vi.resetAllMocks(); });
describe("练习榜挂载", () => {
  it("游客跳转登录", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(LeaderboardView()).rejects.toThrow("/login?next=/leaderboard");
  });
  it("拒绝未授权用户，缺少内容也返回 404", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ uid: 1, username: "u", nickname: "n", avatarUpdatedAt: null, groups: [] });
    vi.mocked(allows).mockReturnValue(false);
    await expect(LeaderboardView()).rejects.toThrow("not-found");
    vi.mocked(allows).mockReturnValue(true);
    await expect(LeaderboardView()).rejects.toThrow("not-found");
    const Board = vi.fn(() => <p>内容榜单</p>);
    siteViews.Leaderboard = Board;
    const result = await LeaderboardView();
    expect(result.type).toBe(Board);
  });
});

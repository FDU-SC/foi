import { afterEach, describe, expect, it, vi } from "vitest";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";
import { navigationFor } from "./site-navigation";

vi.mock("@/lib/authz/engine", () => ({ allows: vi.fn() }));
const originalNavigation = site.navigation;
const originalLeaderboard = siteViews.Leaderboard;
afterEach(() => {
  site.navigation = originalNavigation;
  siteViews.Leaderboard = originalLeaderboard;
  vi.resetAllMocks();
});

describe("导航入口", () => {
  it("旧配置默认留在主导航，账户入口按权限显示", () => {
    site.navigation = [
      { href: "/problems", label: "题库" },
      { href: "/admin", label: "管理", location: "account", visibleWhen: "admin.enter" },
    ];
    expect(navigationFor(ANONYMOUS)).toEqual([{ href: "/problems", label: "题库" }]);
    expect(navigationFor(ANONYMOUS, "account")).toEqual([]);
    vi.mocked(allows).mockReturnValue(true);
    expect(navigationFor(ANONYMOUS, "account")).toEqual([{ href: "/admin", label: "管理" }]);
    expect(allows).toHaveBeenCalledWith("admin.enter", null, ANONYMOUS);
  });

  it("榜单入口同时要求权限和已配置的页面", () => {
    site.navigation = [{ href: "/leaderboard", label: "榜单", location: "catalogue", visibleWhen: "leaderboard.read" }];
    siteViews.Leaderboard = function Leaderboard() { return null; };
    expect(navigationFor(ANONYMOUS, "catalogue")).toEqual([]);
    vi.mocked(allows).mockReturnValue(true);
    expect(navigationFor(ANONYMOUS, "catalogue")).toHaveLength(1);
    delete siteViews.Leaderboard;
    expect(navigationFor(ANONYMOUS, "catalogue")).toEqual([]);
  });
});

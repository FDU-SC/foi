import { afterEach, describe, expect, it, vi } from "vitest";
import { allows } from "@/lib/authz/engine";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { catalogueBoardSections } from "@/lib/contests/catalogue";
import { site } from "@/lib/site";
import { navigationFor } from "./site-navigation";

vi.mock("@/lib/authz/engine", () => ({ allows: vi.fn() }));
vi.mock("@/lib/contests/catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contests/catalogue")>()),
  catalogueBoardSections: vi.fn(),
}));
const originalNavigation = site.navigation;
afterEach(() => {
  site.navigation = originalNavigation;
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

  it("入口可以把其他路径也算作当前页", () => {
    site.navigation = [{ href: "/problems", label: "题库", matches: ["/leaderboard"] }];
    expect(navigationFor(ANONYMOUS)).toEqual([{ href: "/problems", label: "题库", matches: ["/leaderboard"] }]);
  });

  it("榜单入口同时要求权限和总榜覆盖的题库分区", () => {
    site.navigation = [{ href: "/leaderboard", label: "榜单", location: "catalogue", visibleWhen: "leaderboard.read" }];
    vi.mocked(catalogueBoardSections).mockReturnValue(["section"]);
    expect(navigationFor(ANONYMOUS, "catalogue")).toEqual([]);
    vi.mocked(allows).mockReturnValue(true);
    expect(navigationFor(ANONYMOUS, "catalogue")).toHaveLength(1);
    vi.mocked(catalogueBoardSections).mockReturnValue([]);
    expect(navigationFor(ANONYMOUS, "catalogue")).toEqual([]);
  });
});

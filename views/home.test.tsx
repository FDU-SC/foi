import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { allows } from "@/lib/authz/engine";
import { siteViews } from "@/lib/site-views";
import { HomeView } from "./home";
vi.mock("@/auth", () => ({
  getViewer: vi
    .fn()
    .mockResolvedValue({ uid: null, groups: [], authenticated: false }),
}));
vi.mock("@/lib/authz/engine", () => ({
  allows: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/home", () => ({
  homeSubmissions: vi.fn().mockResolvedValue([]),
  recentContests: vi.fn().mockReturnValue([]),
  recentPractice: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/contests/catalogue", () => ({
  catalogueSlugs: () => [],
  contestHref: vi.fn(),
  problemHref: vi.fn(),
}));
vi.mock("@/lib/contests/access", () => ({
  contestsFor: () => [],
  contestFor: vi.fn(),
}));
vi.mock("@/lib/submissions/queue-position", () => ({
  locateInQueues: vi.fn().mockResolvedValue(new Map()),
}));
const originalBoard = siteViews.HomeLeaderboard;
afterEach(() => {
  siteViews.HomeLeaderboard = originalBoard;
  vi.clearAllMocks();
});
function contains(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => contains(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  return node.type === type || contains(node.props.children, type);
}
describe("主页模块边界", () => {
  it("内容和可选插槽都为空时，游客仍能访问主页", async () => {
    vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
    siteViews.HomeLeaderboard = undefined;
    const html = renderToStaticMarkup(await HomeView());
    expect(html).toContain("题库还没有分区");
    expect(html).toContain("暂无比赛");
    expect(html).not.toContain("近期提交");
    expect(html).not.toContain("公告");
  });
  it("无榜单权限时不挂载内容插槽，有权限时才挂载", async () => {
    const Board = () => <div>榜单内容</div>;
    siteViews.HomeLeaderboard = Board;
    vi.mocked(getViewer).mockResolvedValue(viewerFor({ uid: 10, groups: [] }));
    vi.mocked(allows).mockReturnValue(false);
    expect(contains(await HomeView(), Board)).toBe(false);
    vi.mocked(allows).mockReturnValue(true);
    expect(contains(await HomeView(), Board)).toBe(true);
  });
});

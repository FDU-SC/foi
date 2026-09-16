import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { viewerFor } from "@/lib/authz/viewer";
import { contestHref, problemHref } from "@/lib/contests/catalogue";
import { openContestProblem, upcomingProblem, sealedProblem, stagedProblem, viewerWith } from "@/test/content-shapes";
import { ContestWorkspaceView } from "./workspace";
import { ContestDetailView } from "./detail";

const auth = vi.hoisted(() => ({ getViewer: vi.fn() }));
vi.mock("@/auth", () => auth);
vi.mock("next/navigation", () => ({
  usePathname: () => "/contests/test",
  notFound: () => { throw new Error("not-found"); },
}));
afterEach(() => { vi.restoreAllMocks(); });

async function render(slug: string) {
  return renderToStaticMarkup(await ContestWorkspaceView({
    params: Promise.resolve({ slug }), children: <p>题目内容</p>,
  }));
}

describe("比赛工作区权限", () => {
  it("可读比赛的题单链接使用规范地址", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.read"));
    const { contest, problem } = openContestProblem();
    const html = await render(contest.slug);
    expect(html).toContain(contestHref(contest.slug));
    expect(html).toContain(problemHref(contest.slug, problem.slug));
    expect(html).toContain("题目内容");
  });

  it("未开赛和已封闭比赛不泄露题目链接", async () => {
    auth.getViewer.mockResolvedValue(viewerFor(null));
    for (const { contest, problem } of [upcomingProblem(), sealedProblem()]) {
      const html = await render(contest.slug);
      expect(html).not.toContain(problemHref(contest.slug, problem.slug));
      expect(html).toContain("题目内容");
    }
  });

  it("管理员在未开赛比赛能看到预览题单", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.readProblemSet"));
    const { contest, problem } = upcomingProblem();
    const html = await render(contest.slug);
    expect(html).toContain("预览");
    expect(html).toContain(problemHref(contest.slug, problem.slug));
  });

  it("不能读取比赛时布局不拦截子页面，也不泄露比赛信息", async () => {
    auth.getViewer.mockResolvedValue(viewerFor(null));
    const { contest } = stagedProblem();
    expect(await render(contest.slug)).toBe("<p>题目内容</p>");
    await expect(ContestDetailView({ params: Promise.resolve({ slug: contest.slug }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });
});

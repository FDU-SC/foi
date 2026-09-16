import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { viewerFor } from "@/lib/authz/viewer";
import { contestHref, problemHref } from "@/lib/contests/catalogue";
import { openContestProblem, upcomingProblem, sealedProblem, stagedProblem, viewerWith } from "@/test/content-shapes";
import { ContestWorkspaceView } from "./workspace";
import { ContestDetailView } from "./detail";
import * as problemAccess from "@/lib/problems/access";

const auth = vi.hoisted(() => ({ getViewer: vi.fn() }));
const navigation = vi.hoisted(() => ({ pathname: "" }));
vi.mock("@/auth", () => auth);
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  notFound: () => { throw new Error("not-found"); },
}));
afterEach(() => { vi.restoreAllMocks(); navigation.pathname = ""; });

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

  it("未开赛和已封闭比赛不泄露题目链接或数量", async () => {
    auth.getViewer.mockResolvedValue(viewerFor(null));
    for (const { contest, problem } of [upcomingProblem(), sealedProblem()]) {
      const html = await render(contest.slug);
      expect(html).not.toContain(problemHref(contest.slug, problem.slug));
      expect(html).not.toContain('aria-label="可见题目数量"');
      expect(html).toContain("题目内容");
    }
  });

  it("管理员在未开赛比赛能看到预览题单", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.readProblemSet"));
    const { contest, problem } = upcomingProblem();
    const html = await render(contest.slug);
    expect(html).toContain("预览");
    expect(html).toContain('aria-label="可见题目数量"');
    expect(html).toContain(problemHref(contest.slug, problem.slug));
  });

  it("题数来自可见题单而非比赛配置，空题单显示零题", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.read"));
    const ref = openContestProblem();
    const visible = vi.spyOn(problemAccess, "problemsFor");
    for (const problems of [[{ ref, preview: false }], []]) {
      visible.mockReturnValue(problems);
      const html = await render(ref.contest.slug);
      expect(html).toMatch(new RegExp(`aria-label="可见题目数量"[^>]*>${problems.length} 题</span>`));
    }
  });

  it("题单只标记当前入口，移动端摘要包含当前题号与题名", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.read"));
    const { contest, entry, problem } = openContestProblem();
    const problemUrl = problemHref(contest.slug, problem.slug);
    for (const current of [contestHref(contest.slug), problemUrl]) {
      navigation.pathname = current;
      const html = await render(contest.slug);
      const navs = html.match(/<nav aria-label="比赛题单"[\s\S]*?<\/nav>/g) ?? [];
      expect(navs).toHaveLength(2);
      for (const nav of navs) {
        const activeLinks = nav.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
        expect(activeLinks).toHaveLength(1);
        expect(activeLinks[0]).toContain(`href="${current}"`);
      }
      if (current === problemUrl) {
        const summary = html.match(/<summary[\s\S]*?<\/summary>/)?.[0];
        expect(summary).toContain(entry.label ?? problem.slug);
        expect(summary).toContain(problem.title);
      }
    }
  });

  it("不能读取比赛时布局不拦截子页面，也不泄露比赛信息", async () => {
    auth.getViewer.mockResolvedValue(viewerFor(null));
    const { contest } = stagedProblem();
    expect(await render(contest.slug)).toBe("<p>题目内容</p>");
    await expect(ContestDetailView({ params: Promise.resolve({ slug: contest.slug }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });
});

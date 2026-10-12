// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { viewerFor } from "@/lib/authz/viewer";
import { contestHref, problemHref, standingsHref } from "@/lib/contests/catalogue";
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
  it("题单按钮关联有效的受控区域，并提供展开状态", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.read"));
    const { contest } = openContestProblem();
    const html = await render(contest.slug);
    const document = new DOMParser().parseFromString(html, "text/html");
    const button = document.querySelector("button[aria-controls]");
    expect(button).not.toBeNull();
    expect(["true", "false"]).toContain(button?.getAttribute("aria-expanded"));
    expect(document.getElementById(button!.getAttribute("aria-controls")!)).not.toBeNull();
  });


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
      const document = new DOMParser().parseFromString(html, "text/html");
      expect(document.querySelector('[aria-label="可见题目数量"]')?.textContent).toBe(`${problems.length} 题`);
    }
  });

  it("题单与比赛导航只标记当前入口", async () => {
    auth.getViewer.mockResolvedValue(viewerWith("contest.read"));
    const { contest, problem } = openContestProblem();
    const problemUrl = problemHref(contest.slug, problem.slug);
    for (const current of [contestHref(contest.slug), standingsHref(contest.slug), problemUrl]) {
      navigation.pathname = current;
      const html = await render(contest.slug);
      const document = new DOMParser().parseFromString(html, "text/html");
      const navs = document.querySelectorAll('nav[aria-label="比赛题单"]');
      expect(navs.length).toBeGreaterThan(0);
      for (const nav of navs) {
        const activeLinks = nav.querySelectorAll('a[aria-current="page"]');
        expect(activeLinks).toHaveLength(current === problemUrl ? 1 : 0);
        if (current === problemUrl) expect(activeLinks[0].getAttribute("href")).toBe(current);
      }
      const contestNavs = document.querySelectorAll('nav[aria-label="比赛导航"]');
      expect(contestNavs.length).toBeGreaterThan(0);
      for (const nav of contestNavs) {
        const activeLinks = nav.querySelectorAll('a[aria-current="page"]');
        expect(activeLinks).toHaveLength(current === problemUrl ? 0 : 1);
        if (current !== problemUrl) expect(activeLinks[0].getAttribute("href")).toBe(current);
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

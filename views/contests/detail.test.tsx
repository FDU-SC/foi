import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { viewerFor } from "@/lib/authz/viewer";
import {
  stagedProblem,
  upcomingProblem,
  viewerWith,
} from "@/test/content-shapes";
import { ContestDetailView } from "./detail";

vi.mock("@/auth", () => ({
  getViewer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  usePathname: () => "/contests/test",
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const props = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});

describe("比赛详情权限边界", () => {
  it("不可见比赛与不存在的比赛一样返回 404", async () => {
    const ref = stagedProblem();
    vi.mocked(getViewer).mockResolvedValue(viewerFor({ uid: 20, groups: [] }));

    await expect(
      ContestDetailView(props(ref.contest.slug)),
    ).rejects.toThrow("not-found");
  });

  it("未开赛时对选手隐藏题目，只向预览者展示题单", async () => {
    const ref = upcomingProblem();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ref.contest.startsAt.getTime() - 60_000));

    const entrant = viewerFor({
      uid: 21,
      groups: [...(ref.contest.visibleTo ?? [])],
    });
    vi.mocked(getViewer).mockResolvedValue(entrant);

    const entrantHtml = renderToStaticMarkup(
      await ContestDetailView(props(ref.contest.slug)),
    );
    expect(entrantHtml).toContain("题目将在");
    expect(entrantHtml).not.toContain(ref.problem.title);

    vi.mocked(getViewer).mockResolvedValue(
      viewerWith("contest.readProblemSet", 22),
    );
    const previewHtml = renderToStaticMarkup(
      await ContestDetailView(props(ref.contest.slug)),
    );
    expect(previewHtml).toContain("预览 · 尚未对选手公开");
    expect(previewHtml).toContain(ref.problem.title);
  });
});

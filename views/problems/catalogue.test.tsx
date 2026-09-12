import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import {
  contestFor,
  type ContestView,
} from "@/lib/contests/access";
import {
  catalogueSlugs,
  problemHref,
} from "@/lib/contests/catalogue";
import {
  contestConfigSchema,
  type ContestConfig,
} from "@/lib/contests/types";
import {
  problemsFor,
  type ProblemView,
} from "@/lib/problems/access";
import {
  problemConfigSchema,
  type ProblemConfig,
} from "@/lib/problems/types";
import { submissionsFor } from "@/lib/submissions/access";
import type { SubmissionListItem } from "@/lib/submissions/types";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { CatalogueIndexView } from "./catalogue";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/contests/access", () => ({ contestFor: vi.fn() }));
vi.mock("@/lib/contests/catalogue", () => ({
  catalogueSlugs: vi.fn(),
  contestHref: (slug: string) => `/problems/${slug}`,
  problemHref: vi.fn(
    (contest: string, problem: string) => `/problems/${contest}/${problem}`,
  ),
  standingsHref: (slug: string) => `/problems/${slug}/standings`,
}));
vi.mock("@/lib/problems/access", () => ({ problemsFor: vi.fn() }));
vi.mock("@/lib/submissions/access", () => ({ submissionsFor: vi.fn() }));

const NOW = new Date("2030-01-01T00:00:00Z");
const VIEWER = viewerFor({ uid: 7, groups: [] });

function problem(slug: string, title = slug): ProblemConfig {
  return problemConfigSchema.parse({
    slug,
    title,
    backend: { id: "test" },
  });
}

function section(
  slug: string,
  title: string,
  domain: string,
  problems: ProblemConfig[],
): ContestConfig {
  return contestConfigSchema.parse({
    slug,
    title,
    domain,
    leaderboards: [
      { id: "main", title: "排行榜", ruleset: { id: "test" } },
    ],
    startsAt: new Date(+NOW - 60_000).toISOString(),
    endsAt: new Date(+NOW + 60_000).toISOString(),
    problems: problems.map(({ slug: problemSlug }) => ({ slug: problemSlug })),
  });
}

function contestView(config: ContestConfig): ContestView {
  return { config, preview: false };
}

function problemViews(
  contest: ContestConfig,
  problems: ProblemConfig[],
): ProblemView[] {
  return problems.map((item) => ({
    ref: {
      contest,
      entry: contest.problems.find(({ slug }) => slug === item.slug)!,
      problem: item,
    },
    preview: false,
  }));
}

function submission(
  contestSlug: string,
  problemSlug: string,
): SubmissionListItem {
  return {
    id: `${contestSlug}-${problemSlug}`,
    contestSlug,
    problemSlug,
    problemTitle: problemSlug,
    uid: VIEWER.uid!,
    nickname: "测试用户",
    state: "completed",
    result: { accepted: true },
    detail: null,
    reason: null,
    runnerStatus: null,
    createdAt: NOW.toISOString(),
    judgedAt: NOW.toISOString(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
  vi.mocked(catalogueSlugs).mockReturnValue([]);
  vi.mocked(contestFor).mockReturnValue(undefined);
  vi.mocked(problemsFor).mockReturnValue([]);
  vi.mocked(submissionsFor).mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("题库首页访问边界", () => {
  it("不展示无权读取的分区，游客也不查询提交记录", async () => {
    const listedProblems = [
      problem("one", "题目一"),
      problem("two", "题目二"),
      problem("three", "题目三"),
      problem("four", "题目四"),
      problem("five", "题目五"),
    ];
    const visible = section("visible", "公开分区", "公开方向", listedProblems);
    const hidden = section("hidden", "隐藏分区", "隐藏方向", []);

    vi.mocked(catalogueSlugs).mockReturnValue([visible.slug, hidden.slug]);
    vi.mocked(contestFor).mockImplementation((slug) =>
      slug === visible.slug ? contestView(visible) : undefined,
    );
    vi.mocked(problemsFor).mockReturnValue(
      problemViews(visible, listedProblems),
    );

    const html = renderToStaticMarkup(await CatalogueIndexView());

    expect(html).toContain("公开分区");
    expect(html).not.toContain("隐藏分区");
    expect(html).toContain("题目四");
    expect(html).not.toContain("题目五");
    expect(problemsFor).toHaveBeenCalledOnce();
    expect(problemsFor).toHaveBeenCalledWith(visible.slug, ANONYMOUS);
    expect(problemHref).toHaveBeenCalledTimes(4);
    expect(submissionsFor).not.toHaveBeenCalled();
  });

  it("同题跨分区时分别查询并计算登录用户的通过进度", async () => {
    const shared = problem("shared", "共享题目");
    const first = section("first", "第一分区", "同题方向", [shared]);
    const second = section("second", "第二分区", "同题方向", [shared]);
    const sections = new Map([
      [first.slug, first],
      [second.slug, second],
    ]);

    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    vi.mocked(catalogueSlugs).mockReturnValue([...sections.keys()]);
    vi.mocked(contestFor).mockImplementation((slug) => {
      const config = sections.get(slug);
      return config ? contestView(config) : undefined;
    });
    vi.mocked(problemsFor).mockImplementation((slug) => {
      const config = sections.get(slug);
      return config ? problemViews(config, [shared]) : [];
    });
    vi.mocked(submissionsFor).mockImplementation(
      async (_viewer, options) =>
        options?.contestSlug === first.slug
          ? [submission(first.slug, shared.slug)]
          : [],
    );

    const html = renderToStaticMarkup(await CatalogueIndexView());

    expect(html).toContain("已通过 1 / 1");
    expect(html).toContain("已通过 0 / 1");
    expect(submissionsFor).toHaveBeenCalledTimes(2);
    expect(submissionsFor).toHaveBeenCalledWith(VIEWER, {
      contestSlug: first.slug,
      limit: 5000,
    });
    expect(submissionsFor).toHaveBeenCalledWith(VIEWER, {
      contestSlug: second.slug,
      limit: 5000,
    });
  });
});

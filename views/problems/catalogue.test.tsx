import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import {
  contestFor,
  type ContestView,
} from "@/lib/contests/access";
import {
  catalogueSlugs,
  catalogueBoardFor,
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
import { progressFor } from "@/lib/problems/progress";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { CatalogueIndexView } from "./catalogue";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/contests/access", () => ({ contestFor: vi.fn() }));
vi.mock("@/lib/contests/catalogue", () => ({
  catalogueSlugs: vi.fn(),
  catalogueBoardFor: vi.fn(),
  leaderboardHref: (id: string) => `/leaderboard?board=${id}`,
  contestHref: (slug: string) => `/problems/${slug}`,
  problemHref: vi.fn(
    (contest: string, problem: string) => `/problems/${contest}/${problem}`,
  ),
  standingsHref: (slug: string) => `/problems/${slug}/standings`,
}));
vi.mock("@/lib/problems/access", () => ({ problemsFor: vi.fn() }));
vi.mock("@/lib/problems/progress", () => ({ progressFor: vi.fn() }));

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
  vi.mocked(catalogueSlugs).mockReturnValue([]);
  vi.mocked(catalogueBoardFor).mockReturnValue(undefined);
  vi.mocked(contestFor).mockReturnValue(undefined);
  vi.mocked(problemsFor).mockReturnValue([]);
  vi.mocked(progressFor).mockResolvedValue(new Map());
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
    expect(progressFor).not.toHaveBeenCalled();
    expect(html).not.toContain('role="progressbar"');
  });

  it.each([
    { label: "空", partial: false },
    { label: "部分", partial: true },
  ])("登录用户只有$label进度时隐藏不完整汇总", async ({ partial }) => {
    const items = [problem("one"), problem("two")];
    const config = section("incomplete", "不完整分区", "不完整方向", items);
    const statuses = partial
      ? new Map([[items[0].slug, { state: "solved" as const, verdict: null }]])
      : new Map();
    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    vi.mocked(catalogueSlugs).mockReturnValue([config.slug]);
    vi.mocked(contestFor).mockReturnValue(contestView(config));
    vi.mocked(problemsFor).mockReturnValue(problemViews(config, items));
    vi.mocked(progressFor).mockResolvedValue(statuses);

    const html = renderToStaticMarkup(await CatalogueIndexView());

    expect(progressFor).toHaveBeenCalledWith(config.slug, VIEWER);
    expect(html).toContain("2 题");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("0 / 2");
    expect(html).not.toContain("1 / 2");
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
    vi.mocked(progressFor).mockImplementation(async (slug) => new Map([
      [shared.slug, { state: slug === first.slug ? "solved" : "untouched", verdict: null }],
    ]));

    vi.mocked(catalogueBoardFor).mockReturnValue({ id: "direction", title: "同题方向", sections: [first.slug, second.slug], includeInTotal: true });
    const html = renderToStaticMarkup(await CatalogueIndexView());

    expect(html.match(/href="\/leaderboard\?board=direction"/g)).toHaveLength(1);
    expect(html).not.toContain("/standings");
    expect(html).toContain("1 / 1");
    expect(html).toContain("0 / 1");
    expect(html.match(/role="progressbar"/g)).toHaveLength(3);
    expect(html).not.toContain("已通过");
    expect(html).toContain('aria-label="第一分区完成进度"');
    expect(html).toContain('aria-label="第二分区完成进度"');
    expect(html).toContain('aria-label="同题方向完成进度"');
    expect(html).toContain('aria-valuemax="2" aria-valuenow="1"');
    expect(html).toContain('width:50%');
    expect(progressFor).toHaveBeenCalledTimes(2);
    expect(progressFor).toHaveBeenCalledWith(first.slug, VIEWER);
    expect(progressFor).toHaveBeenCalledWith(second.slug, VIEWER);
  });

  it.each([
    { state: "solved" as const, expected: 1 },
    { state: "untouched" as const, expected: 0 },
  ])("单分区方向显示 $state 进度并保留排行榜", async ({ state, expected }) => {
    const item = problem("one");
    const config = section("single", "单一分区", "单一方向", [item]);
    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    vi.mocked(catalogueSlugs).mockReturnValue([config.slug]);
    vi.mocked(contestFor).mockReturnValue(contestView(config));
    vi.mocked(problemsFor).mockReturnValue(problemViews(config, [item]));
    vi.mocked(progressFor).mockResolvedValue(new Map([[item.slug, { state, verdict: null }]]));

    const html = renderToStaticMarkup(await CatalogueIndexView());

    expect(html.match(/role="progressbar"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="单一方向完成进度"');
    expect(html).toContain(`aria-valuemax="1" aria-valuenow="${expected}"`);
    expect(html).toContain(`width:${expected * 100}%`);
    expect(html).toContain('/problems/single/standings');
  });

  it.each([false, true])("隐藏无法统计或没有题目的方向进度（空分区：%s）", async (empty) => {
    const items = empty ? [] : [problem("one")];
    const first = section("first", "第一分区", "方向", items);
    const second = section("second", "第二分区", "方向", items);
    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    vi.mocked(catalogueSlugs).mockReturnValue([first.slug, second.slug]);
    vi.mocked(contestFor).mockImplementation((slug) => contestView(slug === first.slug ? first : second));
    vi.mocked(problemsFor).mockImplementation((slug) => problemViews(slug === first.slug ? first : second, items));
    vi.mocked(progressFor).mockImplementation(async (slug) =>
      slug === first.slug && !empty
        ? new Map([["one", { state: "solved", verdict: null }]])
        : new Map(),
    );

    const html = renderToStaticMarkup(await CatalogueIndexView());

    expect(html).not.toContain('aria-label="方向完成进度"');
    expect(html).not.toContain('aria-label="第二分区完成进度"');
    expect(html.match(/role="progressbar"/g) ?? []).toHaveLength(empty ? 0 : 1);
    expect(html).not.toContain("NaN");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueSlugs,
  isCatalogue,
  problemHref,
} from "@/lib/contests/catalogue";
import { allContests } from "@/lib/contests/registry";
import { pairKey } from "@/lib/contests/types";
import { problemsFor, type ProblemView } from "@/lib/problems/access";
import {
  collectFacets,
  matchesFacets,
} from "@/lib/problems/facets";
import { progressFor } from "@/lib/problems/progress";
import type { ProblemProgress } from "@/lib/problems/views";
import { ProblemSetView } from "./list";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/problems/progress", () => ({ progressFor: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));

const NOW = new Date("2030-01-01T00:00:00Z");
const VIEWER = viewerFor({ uid: 73, groups: [] });

function required<T>(value: T | undefined, shape: string): T {
  if (value === undefined) throw new Error(`内核测试需要${shape}`);
  return value;
}

/** Every catalogued contest an anonymous visitor may read, with its problems. */
function readableLists() {
  return catalogueSlugs().flatMap((slug) => {
    const contest = contestFor(slug, ANONYMOUS, NOW)?.config;
    return contest ? [{ contest, problems: problemsFor(slug, ANONYMOUS, NOW) }] : [];
  });
}

function filterableSection() {
  for (const { contest, problems } of readableLists()) {
    const groups = collectFacets(
      problems.map(({ ref }) => ({ config: ref.problem, offered: ref.contest.facets })),
    );
    for (const group of groups) {
      for (const value of group.values) {
        const matching = problems.filter(({ ref }) =>
          matchesFacets(ref.problem, contest.facets, {
            [group.key]: [value],
          }),
        );
        if (matching.length > 0 && matching.length < problems.length) {
          return { contest, problems, group, value, matching };
        }
      }
    }
  }

  throw new Error("内核测试需要一个可被分面收窄的题库分区");
}

function props(
  section?: string,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return {
    params: Promise.resolve(section === undefined ? {} : { section }),
    searchParams: Promise.resolve(searchParams),
  };
}

async function render(...args: Parameters<typeof props>) {
  return renderToStaticMarkup(await ProblemSetView(props(...args)));
}

function untouched(slugs: readonly string[]): Map<string, ProblemProgress> {
  return new Map(slugs.flatMap((slug) => problemsFor(slug, ANONYMOUS, NOW)).map(({ ref }) => [
    pairKey(ref.contest.slug, ref.problem.slug),
    { state: "untouched", verdict: null },
  ]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
  vi.mocked(progressFor).mockImplementation(async (slugs) => untouched(slugs));
});

afterEach(() => vi.useRealTimers());

describe("题库全部题目", () => {
  it("题单栏列出每个可读的题库分区，表格汇总各分区题目并注明所属题单", async () => {
    const lists = readableLists();
    expect(lists.length, "夹具需要至少两个可读的题库分区").toBeGreaterThan(1);
    const html = await render();

    expect(html).toContain('aria-label="题单"');
    expect(html).toContain(">题单</th>");
    const total = lists.reduce((sum, { problems }) => sum + problems.length, 0);
    expect(html).toContain(`共 ${total} 题`);
    for (const { contest, problems } of lists) {
      expect(html).toContain(contest.title);
      for (const { ref } of problems) {
        expect(html).toContain(`href="${problemHref(contest.slug, ref.problem.slug)}"`);
      }
    }
    expect(html, "游客没有进度，不该画进度条").not.toContain('role="progressbar"');
  });

  it("同一道题挂在两个题单时各占一行，进度一次读取并按比赛与题目成对查找", async () => {
    const lists = readableLists();
    const shared = required(
      lists.flatMap(({ problems }) => problems).find(({ ref }) =>
        lists.filter(({ problems }) => problems.some((view) => view.ref.problem.slug === ref.problem.slug)).length > 1),
      "一道同时挂在两个题库分区的题",
    );
    const holders = lists.filter(({ problems }) => problems.some((view) => view.ref.problem.slug === shared.ref.problem.slug));
    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    vi.mocked(progressFor).mockImplementation(async (slugs) => {
      const progress = untouched(slugs);
      progress.set(pairKey(holders[0].contest.slug, shared.ref.problem.slug), { state: "solved", verdict: null });
      return progress;
    });

    const html = await render();

    expect(progressFor).toHaveBeenCalledOnce();
    expect(progressFor).toHaveBeenCalledWith(lists.map(({ contest }) => contest.slug), VIEWER);
    for (const { contest } of holders) {
      expect(html).toContain(`href="${problemHref(contest.slug, shared.ref.problem.slug)}"`);
    }
    expect(html.match(/已通过<\/span>/g)).toHaveLength(1);
    expect(html).toContain(`>1 / ${holders[0].problems.length}<`);
    const first = holders[0];
    expect(html).toContain(`aria-label="${first.contest.title}完成进度"`);
    expect(html).toContain(`aria-valuemax="${first.problems.length}" aria-valuenow="1"`);
    expect(html).toContain(`width:${100 / first.problems.length}%`);
  });

  it("同一方向有多个题单时汇总方向进度，只有一个题单时不重复显示", async () => {
    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    const html = await render();
    const byDomain = Map.groupBy(readableLists(), ({ contest }) => contest.domain);
    const [heading, shared] = required(
      [...byDomain].find(([, lists]) => lists.length > 1),
      "一个含多个可读题单的方向",
    );
    const [single] = required(
      [...byDomain].find(([, lists]) => lists.length === 1)?.[1],
      "一个只含一个可读题单的方向",
    );
    const total = shared.reduce((sum, { problems }) => sum + problems.length, 0);

    expect(html).toContain(`aria-label="${heading}完成进度"`);
    expect(html).toContain(`aria-valuemax="${total}" aria-valuenow="0"`);
    expect(html).not.toContain(`aria-label="${single.contest.domain}完成进度"`);
    expect(html).toContain(`aria-label="${single.contest.title}完成进度"`);
  });

  it("进度不完整或题单没有题目时隐藏进度条", async () => {
    vi.mocked(getViewer).mockResolvedValue(VIEWER);
    const [first, ...rest] = readableLists();
    vi.mocked(progressFor).mockImplementation(async () => untouched([first.contest.slug]));
    const html = await render();

    expect(html).toContain(`aria-label="${first.contest.title}完成进度"`);
    for (const { contest } of rest) {
      expect(html).not.toContain(`aria-label="${contest.title}完成进度"`);
    }
    expect(html).not.toContain('aria-label="全部题目完成进度"');
    expect(html).not.toContain("NaN");
  });

  it("跨题单时不提供最新排序", async () => {
    const html = await render(undefined, { sort: "newest" });
    expect(html).not.toContain("最新");
    expect(html).toContain("题单序");
  });
});

describe("题库分区页", () => {
  it("非题库比赛不占用分区 URL，且在读取身份和提交前返回 404", async () => {
    const contest = required(
      allContests().find(({ slug }) => !isCatalogue(slug)),
      "一场未挂载到题库的比赛",
    );

    await expect(ProblemSetView(props(contest.slug))).rejects.toThrow(
      "not-found",
    );
    expect(getViewer).not.toHaveBeenCalled();
    expect(progressFor).not.toHaveBeenCalled();
  });

  it("游客按分面收窄题目，不查询或展示个人状态", async () => {
    const { contest, problems, group, value, matching } = filterableSection();
    const html = await render(contest.slug, {
      [`f.${group.key}`]: value,
      status: "solved",
    });

    expect(html).toContain(`${matching.length} / ${problems.length} 题`);
    for (const view of matching) expect(html).toContain(view.ref.problem.title);
    for (const view of excluded(problems, matching)) {
      expect(html).not.toContain(view.ref.problem.title);
    }
    expect(html).not.toContain(">状态</th>");
    expect(html).not.toContain(">题单</th>");
    expect(html).toContain("最新");
    expect(progressFor).not.toHaveBeenCalled();
  });

  it("题单栏标出当前题单，切换题单时保留筛选并回到第一页", async () => {
    const { contest, group, value } = filterableSection();
    const other = required(
      readableLists().find((list) => list.contest.slug !== contest.slug),
      "第二个可读的题库分区",
    );
    const html = await render(contest.slug, { [`f.${group.key}`]: value, page: "2" });
    const carried = new URLSearchParams({ [`f.${group.key}`]: value }).toString();

    expect(html).toContain(`href="/problems?${carried.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`href="/problems/${other.contest.slug}?${carried.replaceAll("&", "&amp;")}"`);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="/problems/${contest.slug}\\?`));
  });

  it("登录用户看到个人状态与完整进度的总计", async () => {
    const { contest, problems } = filterableSection();
    vi.mocked(getViewer).mockResolvedValue(VIEWER);

    const html = await render(contest.slug);

    expect(progressFor).toHaveBeenCalledOnce();
    expect(html).toContain(">状态</th>");
    expect(html).toContain(`已通过 0 / ${problems.length} 题`);
  });
});

function excluded(all: ProblemView[], included: ProblemView[]) {
  const slugs = new Set(included.map(({ ref }) => ref.problem.slug));
  return all.filter(({ ref }) => !slugs.has(ref.problem.slug));
}

it("缺少进度解释时不展示总计或状态筛选", async () => {
  const { contest } = filterableSection();
  vi.mocked(getViewer).mockResolvedValue(VIEWER);
  vi.mocked(progressFor).mockResolvedValue(new Map());
  const html = await render(contest.slug, { status: "solved" });
  expect(html).not.toContain(">状态</th>");
  expect(html).not.toContain("已通过 0 /");
  expect(html).not.toContain('name="status"');
});

it("部分题目支持进度时保留单题显示，隐藏总计及状态筛选", async () => {
  const { contest, problems } = filterableSection();
  vi.mocked(getViewer).mockResolvedValue(VIEWER);
  vi.mocked(progressFor).mockResolvedValue(new Map([
    [pairKey(contest.slug, problems[0].ref.problem.slug), { state: "solved", verdict: { label: "内容进度", short: "X", tone: "neutral" } }],
  ]));
  const html = await render(contest.slug, { status: "solved" });
  expect(html).toContain(">状态</th>");
  expect(html).toContain("内容进度");
  expect(html).not.toContain("已通过 1 /");
  expect(html).not.toContain('name="status"');
  for (const problem of problems) expect(html).toContain(problem.ref.problem.title);
});

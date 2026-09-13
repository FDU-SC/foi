import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueSlugs,
  isCatalogue,
} from "@/lib/contests/catalogue";
import { allContests } from "@/lib/contests/registry";
import { problemsFor, type ProblemView } from "@/lib/problems/access";
import {
  collectFacets,
  matchesFacets,
} from "@/lib/problems/facets";
import { submissionsFor } from "@/lib/submissions/access";
import { ProblemListView } from "./list";

vi.mock("@/auth", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/submissions/access", () => ({
  submissionsFor: vi.fn().mockResolvedValue([]),
}));
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

function filterableSection() {
  for (const slug of catalogueSlugs()) {
    const contest = contestFor(slug, ANONYMOUS, NOW)?.config;
    if (!contest) continue;

    const problems = problemsFor(slug, ANONYMOUS, NOW);
    const groups = collectFacets(
      problems.map(({ ref }) => ref.problem),
      contest.facets,
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
  section: string,
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return {
    params: Promise.resolve({ section }),
    searchParams: Promise.resolve(searchParams),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
  vi.mocked(submissionsFor).mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("题库分区页边界", () => {
  it("非题库比赛不占用分区 URL，且在读取身份和提交前返回 404", async () => {
    const contest = required(
      allContests().find(({ slug }) => !isCatalogue(slug)),
      "一场未挂载到题库的比赛",
    );

    await expect(ProblemListView(props(contest.slug))).rejects.toThrow(
      "not-found",
    );
    expect(getViewer).not.toHaveBeenCalled();
    expect(submissionsFor).not.toHaveBeenCalled();
  });

  it("游客按分面收窄题目，不查询或展示个人状态", async () => {
    const { contest, problems, group, value, matching } = filterableSection();
    const html = renderToStaticMarkup(
      await ProblemListView(
        props(contest.slug, {
          [`f.${group.key}`]: value,
          status: "solved",
        }),
      ),
    );

    expect(html).toContain(`${matching.length} / ${problems.length} 题`);
    for (const view of matching) expect(html).toContain(view.ref.problem.title);
    for (const view of excluded(problems, matching)) {
      expect(html).not.toContain(view.ref.problem.title);
    }
    expect(html).not.toContain("我的状态");
    expect(submissionsFor).not.toHaveBeenCalled();
  });

  it("登录用户的个人状态查询限定在当前比赛", async () => {
    const { contest, problems } = filterableSection();
    vi.mocked(getViewer).mockResolvedValue(VIEWER);

    const html = renderToStaticMarkup(
      await ProblemListView(props(contest.slug)),
    );

    expect(submissionsFor).toHaveBeenCalledOnce();
    expect(submissionsFor).toHaveBeenCalledWith(VIEWER, {
      contestSlug: contest.slug,
      limit: 5000,
    });
    expect(html).toContain("我的状态");
    expect(html).toContain(`已通过 0 / ${problems.length} 题`);
  });
});

function excluded(all: ProblemView[], included: ProblemView[]) {
  const slugs = new Set(included.map(({ ref }) => ref.problem.slug));
  return all.filter(({ ref }) => !slugs.has(ref.problem.slug));
}

import { describe, expect, it } from "vitest";
import { openContestProblem } from "@/test/content-shapes";
import { pairKey } from "@/lib/contests/types";
import { PAGE_SIZE } from "@/lib/paging";
import type { ProblemView } from "./access";
import { facetsFor } from "./facets";
import { allProblems } from "./registry";
import { toPublicConfig } from "./types";
import { viewsFor, type ProblemProgress } from "./views";
import { problemSorts, selectProblems, summarizeProgress } from "./selection";
import type { SearchParams } from "@/lib/query";

// Find two dimensions with a shared value and different values, without naming content.
function fixture() {
  const configs = allProblems();
  const offered = [...new Set(configs.flatMap((p) =>
    viewsFor(p.slug).facets?.(toPublicConfig(p)).map((f) => f.key) ?? [],
  ))];
  for (const a of configs) for (const b of configs) {
    if (a.slug === b.slug) continue;
    const af = facetsFor(a, offered);
    const bf = facetsFor(b, offered);
    for (const dimension of af) {
      const other = bf.find((f) => f.key === dimension.key);
      const av = dimension.values.find((v) => !other?.values.includes(v));
      const bv = other?.values.find((v) => !dimension.values.includes(v));
      if (!av || !bv) continue;
      for (const shared of af) {
        if (shared.key === dimension.key) continue;
        const common = shared.values.find((v) => bf.find((f) => f.key === shared.key)?.values.includes(v));
        if (!common) continue;
        const ref = openContestProblem();
        const contest = { ...ref.contest, facets: [dimension.key, shared.key] };
        const problems: ProblemView[] = [a, b].map((problem, i) => ({
          ref: { contest, problem: { ...problem, title: `Needle ${i}`, maxScore: 50 }, entry: { ...ref.entry, slug: problem.slug, points: i === 0 ? 10 : undefined } },
          preview: false,
        }));
        const progress = new Map<string, ProblemProgress>([
          [pairKey(contest.slug, a.slug), { state: "solved", verdict: null }],
          [pairKey(contest.slug, b.slug), { state: "attempted", verdict: null }],
        ]);
        return { problems, progress, key: dimension.key, av, bv, sharedKey: shared.key, common };
      }
    }
  }
  throw new Error("内核测试需要两个分面同时含共享值和不同值的题目");
}

function select(query: SearchParams = {}) {
  const data = fixture();
  return selectProblems({ ...data, query });
}

function slugs(problems: readonly ProblemView[]) {
  return problems.map(({ ref }) => ref.problem.slug);
}

/** The same views, attributed to a contest with another slug and these facets. */
function movedTo(problems: readonly ProblemView[], slug: string, facets: string[]): ProblemView[] {
  return problems.map((view) => ({
    ...view,
    ref: { ...view.ref, contest: { ...view.ref.contest, slug, facets } },
  }));
}

describe("题库筛选", () => {
  it("搜索、状态与多分面组合时，各项计数只排除自身条件", () => {
    const f = fixture();
    const result = selectProblems({ ...f, query: {
      q: " NEEDLE ", status: "solved", [`f.${f.key}`]: f.av, [`f.${f.sharedKey}`]: f.common,
    } });
    expect(slugs(result.problems)).toEqual([f.problems[0].ref.problem.slug]);
    expect(result.counts.get(f.key)?.get(f.av)).toBe(1);
    expect(result.counts.get(f.key)?.get(f.bv)).toBe(0);
    expect(result.counts.get(f.sharedKey)?.get(f.common)).toBe(1);
    expect(Object.fromEntries(result.statusCounts)).toEqual({ solved: 1, attempted: 0, untouched: 0 });

    const crossed = selectProblems({ ...f, query: {
      q: "needle", status: "solved", [`f.${f.key}`]: f.bv, [`f.${f.sharedKey}`]: f.common,
    } });
    expect(crossed.problems).toEqual([]);
    expect(crossed.counts.get(f.key)?.get(f.av)).toBe(1);
    expect(crossed.statusCounts.get("attempted")).toBe(1);
    expect(crossed.counts.get(f.sharedKey)?.get(f.common)).toBe(0);
  });

  it("同维度多选取并集，重复值去重，跨维度取交集", () => {
    const f = fixture();
    const query = { [`f.${f.key}`]: [f.av, f.bv, f.av], [`f.${f.sharedKey}`]: f.common };
    const result = selectProblems({ ...f, query });
    expect(slugs(result.problems)).toEqual(slugs(f.problems));
    expect(result.selection[f.key]).toEqual([f.av, f.bv]);
    expect(result.counts.get(f.sharedKey)?.get(f.common)).toBe(2);
    expect(selectProblems({ ...f, query: { ...query, q: "absent-title" } }).problems).toEqual([]);
  });

  it("保留未知值、重复参数与搜索原文的处理", () => {
    const f = fixture();
    const query = { q: [" Needle 0 ", "absent"], status: ["invalid", "solved"], sort: ["invalid", "newest"], unrelated: "keep" };
    const result = selectProblems({ ...f, query });
    expect(slugs(result.problems)).toEqual([f.problems[0].ref.problem.slug]);
    expect(result.status).toBeUndefined();
    expect(result.sort).toBe("listed");
    expect(result.searchValue).toBe(" Needle 0 ");
    expect(result.params).toEqual(query);
    expect(selectProblems({ ...f, query: { "f.unknown": "ignored" } }).problems).toHaveLength(2);
    expect(selectProblems({ ...f, query: { [`f.${f.key}`]: "unknown-value" } }).problems).toEqual([]);
    const bare = movedTo(f.problems, f.problems[0].ref.contest.slug, []);
    expect(selectProblems({ ...f, problems: bare, query: { [`f.${f.key}`]: f.av } }).problems).toHaveLength(2);
  });

  it("默认按题单序，最新取题单倒序，分值使用比赛覆盖且同分保持题单序", () => {
    const f = fixture();
    expect(slugs(select().problems)).toEqual(slugs(f.problems));
    expect(slugs(select({ sort: "newest" }).problems)).toEqual(slugs(f.problems).toReversed());
    expect(slugs(select({ sort: "score" }).problems)).toEqual(slugs(f.problems).toReversed());
    const tied = f.problems.map((p) => ({ ...p, ref: { ...p.ref, entry: { ...p.ref.entry, points: 50 } } }));
    expect(slugs(selectProblems({ ...f, problems: tied, query: { sort: "score" } }).problems)).toEqual(slugs(tied));
    expect(select().filtered).toBe(false);
    expect(select({ q: "needle" }).filtered).toBe(true);
    expect(select({ sort: "newest" }).filtered).toBe(true);
  });

  it("筛选不改写题目、进度或查询参数", () => {
    const f = fixture();
    const query = { [`f.${f.key}`]: [f.bv, f.av, f.av], status: "solved" };
    const before = JSON.stringify({ problems: f.problems, progress: [...f.progress], query });
    selectProblems({ ...f, query });
    selectProblems({ ...f, progress: null, query });
    expect(JSON.stringify({ problems: f.problems, progress: [...f.progress], query })).toBe(before);
  });
});

describe("跨比赛题单", () => {
  function spanning() {
    const f = fixture();
    const [first, second] = f.problems;
    const elsewhere = movedTo([second], `${first.ref.contest.slug}-elsewhere`, [f.sharedKey])[0];
    return { ...f, problems: [first, elsewhere] };
  }

  it("跨比赛时不提供最新排序，传入的最新按默认处理", () => {
    const f = spanning();
    expect(problemSorts(f.problems)).toEqual(["listed", "score"]);
    expect(problemSorts(f.problems.slice(0, 1))).toEqual(["listed", "newest", "score"]);
    const result = selectProblems({ ...f, query: { sort: "newest" } });
    expect(result.sort).toBe("listed");
    expect(result.sorts).toEqual(["listed", "score"]);
    expect(slugs(result.problems)).toEqual(slugs(f.problems));
  });

  it("每道题只按自己比赛提供的维度筛选", () => {
    const f = spanning();
    const [first, elsewhere] = f.problems;
    expect(slugs(selectProblems({ ...f, query: { [`f.${f.key}`]: [f.av, f.bv] } }).problems))
      .toEqual([first.ref.problem.slug]);
    expect(slugs(selectProblems({ ...f, query: { [`f.${f.sharedKey}`]: f.common } }).problems))
      .toEqual(slugs([first, elsewhere]));
  });

  it("进度按比赛与题目成对查找，别处的进度不算", () => {
    const f = spanning();
    const [first, elsewhere] = f.problems;
    const progress = new Map<string, ProblemProgress>([
      [pairKey(first.ref.contest.slug, first.ref.problem.slug), { state: "solved", verdict: null }],
      [pairKey(first.ref.contest.slug, elsewhere.ref.problem.slug), { state: "solved", verdict: null }],
    ]);
    expect(summarizeProgress(f.problems, progress)).toEqual({ complete: false, showProgress: true, solved: null });
    progress.set(pairKey(elsewhere.ref.contest.slug, elsewhere.ref.problem.slug), { state: "untouched", verdict: null });
    expect(summarizeProgress(f.problems, progress)).toEqual({ complete: true, showProgress: true, solved: 1 });
  });
});

describe("分页", () => {
  function many(count: number) {
    const f = fixture();
    const [template] = f.problems;
    const problems: ProblemView[] = Array.from({ length: count }, (_, index) => ({
      ...template,
      ref: { ...template.ref, problem: { ...template.ref.problem, slug: `needle-${index}` } },
    }));
    return { ...f, problems, progress: null };
  }

  it("按页切片，页码越界时取最近的一页，计数与汇总不受分页影响", () => {
    const f = many(PAGE_SIZE + 3);
    const first = selectProblems({ ...f, query: {} });
    expect(first.problems).toHaveLength(PAGE_SIZE);
    expect(first).toMatchObject({ page: 1, pages: 2, matched: PAGE_SIZE + 3, narrowed: false });

    const last = selectProblems({ ...f, query: { page: "9" } });
    expect(last.problems.map(({ ref }) => ref.problem.slug)).toEqual(
      [PAGE_SIZE, PAGE_SIZE + 1, PAGE_SIZE + 2].map((index) => `needle-${index}`),
    );
    expect(last.page).toBe(2);
    for (const page of ["0", "-1", "abc", "1.5"]) {
      expect(selectProblems({ ...f, query: { page } }).page).toBe(1);
    }
    expect(last.filtered).toBe(false);
  });
});

describe("个人进度汇总", () => {
  it("完整进度的总数不受筛选影响，与独立汇总一致", () => {
    const f = fixture();
    const summary = summarizeProgress(f.problems, f.progress);
    expect(summary).toEqual({ complete: true, showProgress: true, solved: 1 });
    expect(selectProblems({ ...f, query: { q: "absent" } }).summary).toEqual(summary);
  });

  it("未读取或部分缺失时隐藏状态筛选，保留可用的逐题进度", () => {
    const f = fixture();
    for (const progress of [null, new Map([ [...f.progress][0] ])]) {
      const result = selectProblems({ ...f, progress, query: { status: "solved", q: "needle", unrelated: "keep" } });
      expect(result.summary).toEqual({ complete: false, showProgress: progress !== null, solved: null });
      expect(result.status).toBeUndefined();
      expect(result.problems).toHaveLength(2);
      expect(result.params).toEqual({ q: "needle", unrelated: "keep" });
    }
  });

  it("空题单区分已读取空进度和未读取进度", () => {
    expect(summarizeProgress([], new Map())).toEqual({ complete: true, showProgress: false, solved: 0 });
    expect(summarizeProgress([], null)).toEqual({ complete: false, showProgress: false, solved: null });
  });
});

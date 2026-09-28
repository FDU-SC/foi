import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { openContestProblem, viewerWith } from "@/test/content-shapes";
import { progressFor, solvingSubmission } from "./progress";
import type { ProblemProgress, ProblemViews, ProgressSubmission } from "./views";

const views = vi.hoisted(() => ({ current: {} as ProblemViews }));
vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("./views", () => ({ viewsFor: () => views.current }));

beforeEach(() => {
  views.current = {};
});

describe("进度查询前置条件", () => {
  it("游客和全题单缺少解释时不访问数据库", async () => {
    const { contest } = openContestProblem();
    expect(await progressFor([contest.slug], ANONYMOUS)).toEqual(new Map());
    expect(await progressFor([contest.slug], viewerWith("submission.read"))).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("首次通过的提交", () => {
  const SOLVED = 7;

  const history = (results: unknown[]): ProgressSubmission[] =>
    results.map((result, index) => ({
      id: `sub-${index}`,
      state: "completed",
      result,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
      judgedAt: null,
    }));

  /** Solved once any result is 7, and counts how often it is asked. */
  function interpreting() {
    const progress = vi.fn((rows: readonly ProgressSubmission[]): ProblemProgress => ({
      state: rows.some((row) => row.result === SOLVED) ? "solved" : rows.length > 0 ? "attempted" : "untouched",
      verdict: null,
    }));
    views.current = { progress };
    return progress;
  }

  it("取第一次让内容判为通过的提交，之后的提交不改变它", () => {
    interpreting();
    const rows = history([0, 0, SOLVED, 0, SOLVED]);
    expect(solvingSubmission(openContestProblem(), rows)).toBe(rows[2]);
  });

  it("从未通过或内容不解释进度时没有通过提交", () => {
    interpreting();
    expect(solvingSubmission(openContestProblem(), history([0, 0, 0]))).toBeUndefined();
    expect(solvingSubmission(openContestProblem(), [])).toBeUndefined();

    views.current = {};
    expect(solvingSubmission(openContestProblem(), history([SOLVED]))).toBeUndefined();
  });

  it("长历史只解释对数级个前缀", () => {
    const progress = interpreting();
    const rows = history([...Array<number>(4095).fill(0), SOLVED]);
    expect(solvingSubmission(openContestProblem(), rows)).toBe(rows[4095]);
    expect(progress.mock.calls.length).toBeLessThanOrEqual(Math.ceil(Math.log2(rows.length)) + 1);
  });
});

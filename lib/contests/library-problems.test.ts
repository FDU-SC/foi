import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryLink } from "@/lib/problems/library";

/**
 * Authoring writes problems into the database while contests stay files, so a
 * problem's belonging is the two lists read together. What is checked here is
 * that reading them together produces one ordered problem set — a declared list
 * keeps its order, an authored problem lands at its tail, and nothing gains a
 * second entry.
 */

const state = vi.hoisted(() => ({
  generation: 0,
  links: new Map<string, LibraryLink[]>(),
  problems: new Map<string, unknown>(),
}));

vi.mock("@/lib/problems/library", () => ({
  libraryGeneration: () => state.generation,
  // The store hands these back in `position` order; mirrored here so the test
  // is about the merge rather than about the sort.
  libraryLinksIn: (slug: string) =>
    [...(state.links.get(slug) ?? [])].sort(
      (a, b) => a.position - b.position || a.slug.localeCompare(b.slug),
    ),
  libraryProblem: (slug: string) => state.problems.get(slug),
  libraryProblems: () => state.problems,
  libraryStatement: () => undefined,
  refreshLibrary: async () => {},
  resetLibrary: () => {},
}));

const { contestBySlug, contestProblemsOf } = await import("@/lib/contests/registry");
const { contestProblemRefs, contestProblemRefsIn } = await import(
  "@/lib/contests/refs"
);

function authored(slug: string, title: string) {
  return {
    slug,
    title,
    maxScore: 100,
    backend: { id: "fixture-backend", config: {} },
    submit: {},
    viewsPreset: "fixture-plain",
  };
}

const OPEN = "fixture-open";

beforeEach(() => {
  state.generation += 1;
  state.links = new Map();
  state.problems = new Map();
});

describe("比赛的题单是两个来源合起来的", () => {
  it("没有库中的题目时，就是 contest.ts 声明的那一份", () => {
    const contest = contestBySlug(OPEN)!;
    expect(contestProblemsOf(contest)).toEqual(contest.problems);
  });

  it("库中的题目按 position 排，接在声明的那一份之后", () => {
    state.problems.set("authored-b", authored("authored-b", "乙"));
    state.problems.set("authored-a", authored("authored-a", "甲"));
    state.links.set(OPEN, [
      { slug: "authored-b", label: "C", position: 1 },
      { slug: "authored-a", label: null, position: 0 },
    ]);
    const contest = contestBySlug(OPEN)!;
    const merged = contestProblemsOf(contest);

    expect(merged.slice(0, contest.problems.length)).toEqual(contest.problems);
    expect(merged.slice(contest.problems.length)).toEqual([
      { slug: "authored-a" },
      { slug: "authored-b", label: "C" },
    ]);
  });

  it("比赛已经声明的题目不会被库里的行重复一遍", () => {
    state.problems.set("fixture-inline", authored("fixture-inline", "重复"));
    state.links.set(OPEN, [{ slug: "fixture-inline", label: "A", position: 0 }]);

    const contest = contestBySlug(OPEN)!;
    const merged = contestProblemsOf(contest);

    expect(merged.filter((entry) => entry.slug === "fixture-inline")).toHaveLength(1);
    expect(merged).toEqual(contest.problems);
  });
});

describe("库中的题目因此有了地址", () => {
  it("发布之后，那一对出现在所有 (比赛, 题目) 的索引里", () => {
    const before = contestProblemRefs().filter((ref) => ref.problem.slug === "authored-a");
    expect(before).toEqual([]);

    // 发布写库、把题放进比赛，然后重载快照。
    state.problems.set("authored-a", authored("authored-a", "甲"));
    state.links.set(OPEN, [{ slug: "authored-a", label: "C", position: 0 }]);
    state.generation += 1;

    const after = contestProblemRefs().filter((ref) => ref.problem.slug === "authored-a");
    expect(after).toHaveLength(1);
    expect(after[0]!.entry.label).toBe("C");
    expect(contestProblemRefsIn(OPEN).at(-1)!.problem.slug).toBe("authored-a");
  });

  it("快照没有变时索引不重建，所以读它不读库", () => {
    state.problems.set("authored-a", authored("authored-a", "甲"));
    state.links.set(OPEN, [{ slug: "authored-a", label: null, position: 0 }]);
    state.generation += 1;

    const first = contestProblemRefs();
    expect(contestProblemRefs()).toBe(first);
  });
});

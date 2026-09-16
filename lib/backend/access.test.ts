import { describe, expect, it } from "vitest";
import { backends } from "@/lib/backend/registry";
import { AS_PLAYER } from "@/test/auth-support";
import { upcomingProblem, viewerWith } from "@/test/content-shapes";
import { contestProblemRefs } from "@/lib/contests/refs";
import { problemFor } from "@/lib/problems/access";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import { isInlineBackend } from "@/lib/problems/types";
import {
  canSeeBackend,
  backendsFor,
  orphanedBackends,
  problemsServedBy,
} from "./access";

const INSPECTOR = viewerWith("backend.inspect", 100);
const SETTER = viewerWith("problem.read", 101);

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

/** Whether any contest currently opens a problem this backend judges. */
function reachable(backendId: string, now = new Date()): boolean {
  const served = new Set(problemsServedBy(backendId));
  return contestProblemRefs().some(
    (ref) =>
      served.has(ref.problem.slug) &&
      problemFor(ref.contest.slug, ref.problem.slug, AS_PLAYER, now) !==
        undefined,
  );
}

describe("题目后端→题目 反向索引", () => {
  it("每道题都反查到它自己声明的题目后端", () => {
    for (const problem of externallyJudged()) {
      expect(problemsServedBy(problem.backend.id)).toContain(problem.slug);
    }
  });

  it("索引覆盖题目声明的全部题目后端 id", () => {
    const declared = new Set(externallyJudged().map((p) => p.backend.id));
    for (const id of declared) {
      expect(problemsServedBy(id).length).toBeGreaterThan(0);
    }
  });

  it("未知题目后端反查为空", () => {
    expect(problemsServedBy("no-such-backend")).toEqual([]);
  });

  it("orphanedBackends 列出没有任何题目指向的题目后端", () => {
    const referenced = new Set(externallyJudged().map((p) => p.backend.id));
    for (const id of orphanedBackends()) {
      expect(referenced.has(id)).toBe(false);
    }
  });

  it("内联判题的题目不进反向索引", () => {
    const inline = allProblems().filter((p) => isInlineBackend(p.backend));
    expect(inline.length).toBeGreaterThan(0);

    for (const problem of inline) {
      for (const id of Object.keys(backends)) {
        expect(problemsServedBy(id)).not.toContain(problem.slug);
      }
    }
  });
});

describe("canSeeBackend", () => {
  it("被放行 backend.read 的人看得到全部题目后端，包括没有题目指向的", () => {
    for (const id of Object.keys(backends)) {
      expect(canSeeBackend(id, INSPECTOR)).toBe(true);
    }
  });

  it("选手只看得到承载了至少一道他能看到的题目的题目后端", () => {
    for (const id of Object.keys(backends)) {
      expect(canSeeBackend(id, AS_PLAYER)).toBe(reachable(id));
    }
  });

  it("没有任何题目指向的题目后端对选手不可见", () => {
    for (const id of orphanedBackends()) {
      expect(canSeeBackend(id, AS_PLAYER)).toBe(false);
    }
  });

  it("只承载未开赛题目的题目后端，对选手隐藏、对出题人可见", () => {
    const upcoming = upcomingProblem();
    const backendId = externallyJudged().find(
      (p) => p.slug === upcoming.problem.slug,
    )?.backend.id;
    if (!backendId) return;

    const at = before(upcoming.contest.startsAt);
    if (!reachable(backendId, at)) {
      expect(canSeeBackend(backendId, AS_PLAYER, at)).toBe(false);
    }

    expect(canSeeBackend(backendId, SETTER, at)).toBe(true);
  });
});

describe("backendsFor", () => {
  it("选手拿到的题目后端是全集的子集", () => {
    const all = Object.keys(backends);
    const forPlayer = backendsFor(AS_PLAYER);

    expect(forPlayer.every((id) => all.includes(id))).toBe(true);
    expect(forPlayer.length).toBeLessThanOrEqual(all.length);
  });

  it("检查者拿到全集", () => {
    expect(backendsFor(INSPECTOR).sort()).toEqual(Object.keys(backends).sort());
  });

  it("与 canSeeBackend 逐项一致", () => {
    const forPlayer = new Set(backendsFor(AS_PLAYER));
    for (const id of Object.keys(backends)) {
      expect(forPlayer.has(id)).toBe(canSeeBackend(id, AS_PLAYER));
    }
  });
});

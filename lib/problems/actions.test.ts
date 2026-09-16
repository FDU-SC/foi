import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { allows } from "@/lib/authz/engine";
import type { ContestProblemRef } from "@/lib/authz/resources";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import {
  archivedProblem,
  upcomingProblem,
  viewerWith,
} from "@/test/content-shapes";
import { contestProblemRefs } from "@/lib/contests/refs";
import { problemFor } from "@/lib/problems/access";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import {
  DEFAULT_ACTION_RATE_LIMIT,
  isInlineBackend,
} from "@/lib/problems/types";
import { declaredAction } from "./actions";

const PREVIEW = viewerWith("problem.read", 100);
const PLAYER = viewerFor({ uid: 1, groups: ["一个普通分组"] });

/** Every (contest, problem, action) triple the deployment declares. */
const declared = contestProblemRefs().flatMap((ref) => {
  const backend = ref.problem.backend;
  if (isInlineBackend(backend)) return [];
  return Object.keys(backend.actions).map((action) => ({ ref, action }));
});

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

/** Both halves of the gate: the action exists, and it may be invoked. */
function invocable(
  ref: ContestProblemRef,
  action: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  if (!allows("problem.invoke", ref, viewer, { now, invocation: action })) {
    return false;
  }
  return declaredAction(ref.problem, action) !== undefined;
}

describe("declaredAction 白名单", () => {
  it("仓库里至少声明了一个 action，否则这组用例什么也没测", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("声明的 action 没有占用后端自己的协议路径", () => {
    for (const { ref, action } of declared) {
      expect(["judge", "queue", "status"], ref.problem.slug).not.toContain(
        action,
      );
    }
  });

  it("声明过的 action 解析得出", () => {
    for (const { ref, action } of declared) {
      expect(declaredAction(ref.problem, action)?.action).toBe(action);
    }
  });

  it("没声明的 action 一律 undefined，而不是转发过去", () => {
    for (const { ref } of declared) {
      expect(declaredAction(ref.problem, "no-such-action")).toBeUndefined();
    }
  });

  it("评测协议的路径不能借 action 通道转发", () => {
    for (const { ref } of declared) {
      for (const path of ["judge", "queue", "status"]) {
        expect(declaredAction(ref.problem, path)).toBeUndefined();
      }
    }
  });

  it("内联判题的题目没有任何可调的 action", () => {
    const inline = allProblems().filter((p) => isInlineBackend(p.backend));
    expect(inline.length).toBeGreaterThan(0);

    for (const problem of inline) {
      for (const action of ["some-action", "another-action"]) {
        expect(declaredAction(problem, action)).toBeUndefined();
      }
    }
  });
});

describe("declaredAction 配额", () => {
  it("声明了 rateLimit 就用声明的那个", () => {
    const own = externallyJudged().flatMap((problem) =>
      Object.entries(problem.backend.actions)
        .filter(([, spec]) => spec.rateLimit)
        .map(([action, spec]) => ({ problem, action, spec })),
    );

    expect(own.length).toBeGreaterThan(0);
    for (const { problem, action, spec } of own) {
      expect(declaredAction(problem, action)?.rateLimit).toEqual(spec.rateLimit);
    }
  });

  it("没声明就用内核默认值", () => {
    const bare = externallyJudged().flatMap((problem) =>
      Object.entries(problem.backend.actions)
        .filter(([, spec]) => !spec.rateLimit)
        .map(([action]) => ({ problem, action })),
    );

    for (const { problem, action } of bare) {
      expect(declaredAction(problem, action)?.rateLimit).toEqual(
        DEFAULT_ACTION_RATE_LIMIT,
      );
    }
  });
});

describe("problem.invoke", () => {
  it("匿名的人调不动任何 action", () => {
    for (const { ref, action } of declared) {
      expect(invocable(ref, action, AS_PLAYER)).toBe(false);
    }
  });

  const upcoming = declared.find(
    ({ ref }) => ref.contest.slug === upcomingProblem().contest.slug,
  );

  it.skipIf(!upcoming)("能预览未开赛题面的人，也调不动它的 action", () => {
    const at = before(upcoming!.ref.contest.startsAt);
    const { contest, problem } = upcoming!.ref;

    expect(problemFor(contest.slug, problem.slug, PREVIEW, at)).toBeDefined();
    expect(invocable(upcoming!.ref, upcoming!.action, PREVIEW, at)).toBe(false);
  });

  const archived = declared.find(
    ({ ref }) => ref.contest.slug === archivedProblem().contest.slug,
  );

  it.skipIf(!archived)(
    "已归档比赛声明过的 action 也调不动，尽管题面还读得到",
    () => {
      const { contest, problem } = archived!.ref;

      expect(problemFor(contest.slug, problem.slug, PLAYER)).toBeDefined();
      expect(invocable(archived!.ref, archived!.action, PLAYER)).toBe(false);
      expect(invocable(archived!.ref, archived!.action, PREVIEW)).toBe(false);
    },
  );

  it("正在收题的比赛里，登录的人调得动它声明过的 action", () => {
    const live = declared.filter(({ ref }) =>
      allows("problem.submit", ref, PLAYER),
    );
    expect(live.length).toBeGreaterThan(0);

    for (const { ref, action } of live) {
      expect(invocable(ref, action, PLAYER)).toBe(true);
    }
  });

  it("能调 action 与能提交是同一组前提", () => {
    const viewers: Viewer[] = [AS_PLAYER, PLAYER, PREVIEW];
    const moments = [
      new Date(),
      before(upcomingProblem().contest.startsAt),
      new Date("2000-01-01"),
    ];

    for (const viewer of viewers) {
      for (const now of moments) {
        for (const { ref, action } of declared) {
          expect(
            invocable(ref, action, viewer, now),
            `${ref.contest.slug}/${ref.problem.slug}/${action}`,
          ).toBe(allows("problem.submit", ref, viewer, { now }));
        }
      }
    }
  });
});

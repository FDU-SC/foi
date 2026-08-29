import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { allows } from "@/lib/authz/engine";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { viewerWith } from "@/test/content-shapes";
import { allContests } from "@/lib/contests/registry";
import { problemFor } from "@/lib/problems/access";
import {
  allProblems,
  externallyJudged,
  problemBySlug,
} from "@/lib/problems/registry";
import {
  DEFAULT_ACTION_RATE_LIMIT,
  isInlineBackend,
  type ProblemConfig,
} from "@/lib/problems/types";
import { declaredAction } from "./actions";

const demo = allContests()[0];

const PREVIEW = viewerWith("problem.read", 100);
const PLAYER = viewerFor({ uid: 1, groups: ["一个普通分组"] });

const declared = externallyJudged().flatMap((problem) =>
  Object.keys(problem.backend.actions).map((action) => ({
    problem: problem as ProblemConfig,
    action,
  })),
);

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

/** Both halves of the gate: the action exists, and it may be invoked. */
function invocable(
  slug: string,
  action: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  const problem = problemBySlug(slug);
  if (!problem) return false;
  if (!allows("problem.invoke", problem, viewer, { now, invocation: action })) {
    return false;
  }
  return declaredAction(problem, action) !== undefined;
}

describe("declaredAction 白名单", () => {
  it("仓库里至少声明了一个 action，否则这组用例什么也没测", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("声明的 action 没有占用后端自己的协议路径", () => {
    for (const { problem, action } of declared) {
      expect(["judge", "queue", "status"], problem.slug).not.toContain(action);
    }
  });

  it("声明过的 action 解析得出", () => {
    for (const { problem, action } of declared) {
      expect(declaredAction(problem, action)?.action).toBe(action);
    }
  });

  it("没声明的 action 一律 undefined，而不是转发过去", () => {
    for (const { problem } of declared) {
      expect(declaredAction(problem, "no-such-action")).toBeUndefined();
    }
  });

  it("评测协议的路径不能借 action 通道转发", () => {
    for (const { problem } of declared) {
      for (const path of ["judge", "queue", "status"]) {
        expect(declaredAction(problem, path)).toBeUndefined();
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

const embargoed = demo
  ? declared.find(({ problem }) =>
      demo.problems.some((entry) => entry.slug === problem.slug),
    )
  : undefined;

describe("problem.invoke", () => {
  it("匿名的人调不动任何 action", () => {
    for (const { problem, action } of declared) {
      expect(invocable(problem.slug, action, AS_PLAYER)).toBe(false);
    }
  });

  it.skipIf(!embargoed || !demo)(
    "能预览未开赛题面的人，也调不动它的 action",
    () => {
      const at = before(demo!.startsAt);

      expect(problemFor(embargoed!.problem.slug, PREVIEW, at)).toBeDefined();
      expect(
        invocable(embargoed!.problem.slug, embargoed!.action, PREVIEW, at),
      ).toBe(false);
    },
  );

  const retired = declared.filter(({ problem }) => problem.retired);

  it.skipIf(retired.length === 0)(
    "下架题目声明过的 action 也调不动，尽管题面还读得到",
    () => {
      for (const { problem, action } of retired) {
        expect(problemFor(problem.slug, PLAYER)).toBeDefined();
        expect(invocable(problem.slug, action, PLAYER)).toBe(false);
        expect(invocable(problem.slug, action, PREVIEW)).toBe(false);
      }
    },
  );

  it("在役、已公开的题目，登录的人调得动它声明过的 action", () => {
    const live = declared.filter(({ problem }) => !problem.retired);
    expect(live.length).toBeGreaterThan(0);

    for (const { problem, action } of live) {
      if (!problemFor(problem.slug, PLAYER)) continue;
      if (!allows("problem.submit", problem, PLAYER)) continue;

      expect(invocable(problem.slug, action, PLAYER)).toBe(true);
    }
  });

  it("能调 action 与能提交是同一组前提", () => {
    const viewers: Viewer[] = [AS_PLAYER, PLAYER, PREVIEW];
    const moments = demo ? [new Date(), before(demo.startsAt)] : [new Date()];

    for (const viewer of viewers) {
      for (const now of moments) {
        for (const { problem, action } of declared) {
          expect(
            invocable(problem.slug, action, viewer, now),
            `${problem.slug}/${action}`,
          ).toBe(allows("problem.submit", problem, viewer, { now }));
        }
      }
    }
  });
});

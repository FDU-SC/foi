import { describe, expect, it } from "vitest";
import { AS_PLAYER, viewerFor, type Viewer } from "@/lib/auth/viewer";
import { allContests } from "@/lib/contests/registry";
import { problemFor } from "@/lib/problems/access";
import { allProblems } from "@/lib/problems/registry";
import { DEFAULT_ACTION_RATE_LIMIT } from "@/lib/problems/types";
import { actionFor } from "./actions";

/**
 * Run against the real `content/` registries, like the problem gate it wraps:
 * the point is that the actions this deployment actually ships are reachable
 * by exactly the people who may already see their problem.
 */
const demo = allContests().find((contest) => contest.slug === "demo-acm");

const PREVIEW = viewerFor({ handle: "an-admin", groups: ["管理员"] });
const PLAYER = viewerFor({ handle: "bob", groups: ["本科生", "2026级"] });

/** Every (problem, action) pair the repository declares. */
const declared = allProblems().flatMap((problem) =>
  Object.keys(problem.backend.actions).map((action) => ({
    slug: problem.slug,
    action,
  })),
);

/** The subset still in service. A retired problem's actions are closed too. */
const live = allProblems()
  .filter((problem) => !problem.retired)
  .flatMap((problem) =>
    Object.keys(problem.backend.actions).map((action) => ({
      slug: problem.slug,
      action,
    })),
  );

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

describe("actionFor 白名单", () => {
  it("仓库里至少声明了一个 action，否则这组用例什么也没测", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("在役题目声明过的 action 解析得出", () => {
    expect(live.length).toBeGreaterThan(0);
    for (const { slug, action } of live) {
      expect(actionFor(slug, action, PLAYER)?.action).toBe(action);
    }
  });

  it("没声明的 action 一律 undefined，而不是转发过去", () => {
    for (const { slug } of declared) {
      expect(actionFor(slug, "no-such-action", PLAYER)).toBeUndefined();
    }
  });

  it("评测协议的路径不能借 action 通道转发", () => {
    // The whitelist is what keeps this from being a general proxy. If the path
    // segment were relayed as-is, these would reach the backend's own
    // endpoints with a valid signature on them.
    for (const { slug } of declared) {
      for (const path of ["judge", "queue", "status"]) {
        expect(actionFor(slug, path, PLAYER)).toBeUndefined();
      }
    }
  });

  it("不存在的题目 undefined", () => {
    expect(actionFor("no-such-problem", "spawn", PLAYER)).toBeUndefined();
  });

  it("没有声明任何 action 的题目，什么都调不动", () => {
    const inert = allProblems().filter(
      (problem) => Object.keys(problem.backend.actions).length === 0,
    );
    for (const problem of inert) {
      expect(actionFor(problem.slug, "spawn", PLAYER)).toBeUndefined();
    }
  });
});

describe("actionFor 配额", () => {
  it("声明了 rateLimit 就用声明的那个", () => {
    const own = allProblems().flatMap((problem) =>
      Object.entries(problem.backend.actions)
        .filter(([, spec]) => spec.rateLimit)
        .map(([action, spec]) => ({ slug: problem.slug, action, spec })),
    );

    expect(own.length).toBeGreaterThan(0);
    for (const { slug, action, spec } of own) {
      expect(actionFor(slug, action, PLAYER)?.rateLimit).toEqual(spec.rateLimit);
    }
  });

  it("没声明就用内核默认值", () => {
    const bare = allProblems()
      .filter((problem) => !problem.retired)
      .flatMap((problem) =>
        Object.entries(problem.backend.actions)
          .filter(([, spec]) => !spec.rateLimit)
          .map(([action]) => ({ slug: problem.slug, action })),
      );

    for (const { slug, action } of bare) {
      expect(actionFor(slug, action, PLAYER)?.rateLimit).toEqual(
        DEFAULT_ACTION_RATE_LIMIT,
      );
    }
  });
});

/**
 * A problem that both declares an action and sits in a contest, if one is
 * shipped. Nothing does today — the demo contest holds `maze-runner`, which
 * declares none — so the two cases below skip rather than pass vacuously. The
 * behaviour they describe is verified by the invariant at the end of this
 * file, which holds over every problem and moment regardless.
 */
const embargoed = demo
  ? allProblems()
      .filter((problem) =>
        demo.problems.some((entry) => entry.slug === problem.slug),
      )
      .flatMap((problem) =>
        Object.keys(problem.backend.actions).map((action) => ({
          slug: problem.slug,
          action,
        })),
      )[0]
  : undefined;

describe("actionFor 门禁", () => {
  it.skipIf(!embargoed || !demo)(
    "未开赛时，选手拿不到它的 action",
    () => {
      expect(
        actionFor(embargoed!.slug, embargoed!.action, AS_PLAYER, before(demo!.startsAt)),
      ).toBeUndefined();
    },
  );

  it.skipIf(!embargoed || !demo)(
    "持 problem.viewAll 的人读得到未开赛的题面，但调不动它的 action",
    () => {
      const at = before(demo!.startsAt);
      // Reads it — that is what the capability is for.
      expect(problemFor(embargoed!.slug, PREVIEW, at)).toBeDefined();
      // And still cannot start anything on it: proofreading a round should no
      // more spin up its containers than it should queue work on its judges.
      expect(actionFor(embargoed!.slug, embargoed!.action, PREVIEW, at)).toBeUndefined();
    },
  );

  /**
   * The regression that matters most, stated as a property.
   *
   * The submission path once asked `AS_PLAYER` here, which collapses "may this
   * person see it" into "may anybody see it" and gets the first one wrong: a
   * problem given to 校队 has no audience under a viewer with no groups, so the
   * members it was written for were refused. Nothing shipped today restricts
   * an action's problem by audience, so this is written as an invariant rather
   * than a case — add such a problem and a regression to `AS_PLAYER` breaks
   * this immediately.
   */
  it("答案逐项等于「这道题现在开着」且「声明过这个 action」", () => {
    const viewers: Viewer[] = [AS_PLAYER, PLAYER, PREVIEW];
    const moments = demo
      ? [new Date(), before(demo.startsAt)]
      : [new Date()];

    for (const viewer of viewers) {
      for (const now of moments) {
        for (const problem of allProblems()) {
          for (const action of Object.keys(problem.backend.actions)) {
            const open = problemFor(problem.slug, viewer, now);
            expect(Boolean(actionFor(problem.slug, action, viewer, now))).toBe(
              Boolean(open?.open),
            );
          }
        }
      }
    }
  });

  /**
   * Retirement closes the interactive channel along with submission, and for
   * the same reason: reading an old statement is not a licence to spend the
   * backend's resources on it. Stated separately from the invariant above
   * because it is the case where `gate.visible` and `open` disagree — if
   * `actionFor` ever drifts back to reading the former, only this fails.
   */
  it("下架题目声明过的 action 也调不动，尽管题面还读得到", () => {
    const retired = allProblems()
      .filter((problem) => problem.retired)
      .flatMap((problem) =>
        Object.keys(problem.backend.actions).map((action) => ({
          slug: problem.slug,
          action,
        })),
      );

    expect(retired.length).toBeGreaterThan(0);
    for (const { slug, action } of retired) {
      expect(problemFor(slug, PLAYER)?.gate.visible).toBe(true);
      expect(actionFor(slug, action, PLAYER)).toBeUndefined();
      expect(actionFor(slug, action, PREVIEW)).toBeUndefined();
    }
  });
});

import { describe, expect, it } from "vitest";
import { judges } from "@/judges.config";
import { AS_PLAYER, viewerFor, type Viewer } from "@/lib/auth/viewer";
import { allContests } from "@/lib/contests/registry";
import { problemFor } from "@/lib/problems/access";
import { allProblems } from "@/lib/problems/registry";
import {
  canSeeJudge,
  judgesFor,
  orphanedJudges,
  problemsServedBy,
} from "./access";

const PREVIEW = viewerFor({ handle: "an-admin", groups: ["管理员"] });

/**
 * Sees unreleased problems but not the infrastructure.
 *
 * Built by hand because no shipped role holds that combination — which is the
 * point of the case: `problem.viewAll` and `judge.inspect` have to stay
 * independent, so that a deployment adding such a role gets the behaviour
 * without also having to touch the gate.
 */
const SETTER: Viewer = {
  handle: "setter",
  groups: ["出题人"],
  can: (capability) => capability === "problem.viewAll",
};

const demo = allContests().find((contest) => contest.slug === "demo-acm");

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

describe("判题机→题目 反向索引", () => {
  it("每道题都反查到它自己声明的判题机", () => {
    for (const problem of allProblems()) {
      expect(problemsServedBy(problem.judge.id)).toContain(problem.slug);
    }
  });

  it("索引覆盖题目声明的全部判题机 id", () => {
    const declared = new Set(allProblems().map((p) => p.judge.id));
    for (const id of declared) {
      expect(problemsServedBy(id).length).toBeGreaterThan(0);
    }
  });

  it("未知判题机反查为空", () => {
    expect(problemsServedBy("no-such-judge")).toEqual([]);
  });

  it("orphanedJudges 列出没有任何题目指向的判题机", () => {
    const referenced = new Set(allProblems().map((p) => p.judge.id));
    for (const id of orphanedJudges()) {
      expect(referenced.has(id)).toBe(false);
    }
  });
});

describe("canSeeJudge", () => {
  it("持有 judge.inspect 的人看得到全部判题机，包括没有题目指向的", () => {
    for (const id of Object.keys(judges)) {
      expect(canSeeJudge(id, PREVIEW)).toBe(true);
    }
  });

  it("选手只看得到承载了至少一道他能看到的题目的判题机", () => {
    for (const id of Object.keys(judges)) {
      const reachable = problemsServedBy(id).some(
        (slug) => problemFor(slug, AS_PLAYER) !== undefined,
      );
      expect(canSeeJudge(id, AS_PLAYER)).toBe(reachable);
    }
  });

  it("没有任何题目指向的判题机对选手不可见", () => {
    for (const id of orphanedJudges()) {
      expect(canSeeJudge(id, AS_PLAYER)).toBe(false);
    }
  });

  it("只承载未开赛题目的判题机，对选手隐藏、对出题人可见", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;
    const judgeId = allProblems().find((p) => p.slug === slug)?.judge.id;
    if (!judgeId) return;

    // Pick a moment before the contest opens, and only assert when this judge
    // serves nothing else — otherwise another problem legitimately reveals it.
    const at = before(demo.startsAt);
    const others = problemsServedBy(judgeId).filter((s) => s !== slug);
    const otherVisible = others.some(
      (s) => problemFor(s, AS_PLAYER, at) !== undefined,
    );

    if (!otherVisible) {
      expect(canSeeJudge(judgeId, AS_PLAYER, at)).toBe(false);
    }
    // A setter sees the problem, so seeing its judge reveals nothing further.
    expect(canSeeJudge(judgeId, SETTER, at)).toBe(true);
  });
});

describe("judgesFor", () => {
  it("选手拿到的判题机是全集的子集", () => {
    const all = Object.keys(judges);
    const forPlayer = judgesFor(AS_PLAYER);

    expect(forPlayer.every((id) => all.includes(id))).toBe(true);
    expect(forPlayer.length).toBeLessThanOrEqual(all.length);
  });

  it("检查者拿到全集", () => {
    expect(judgesFor(PREVIEW).sort()).toEqual(Object.keys(judges).sort());
  });

  it("与 canSeeJudge 逐项一致", () => {
    const forPlayer = new Set(judgesFor(AS_PLAYER));
    for (const id of Object.keys(judges)) {
      expect(forPlayer.has(id)).toBe(canSeeJudge(id, AS_PLAYER));
    }
  });
});

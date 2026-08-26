import { describe, expect, it } from "vitest";
import { listGroups } from "@/lib/auth/groups";
import { allContests, contestBySlug } from "@/lib/contests/registry";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import { backends } from "@/lib/backend/registry";
import { undeclaredBackends } from "@/lib/backend/access";
import { isInlineBackend } from "@/lib/problems/types";

/**
 * That *this* content is coherent, and that it exercises the kernel.
 *
 * Two jobs, and they used to be done in the wrong place. The kernel's own
 * suites reached into the registries by name — `contestBySlug("demo-acm")`,
 * `roulette-daily`, a `traditional` queue — which meant the platform's tests
 * could not run against any other `content/`, and meant a content edit broke
 * `lib/` rather than breaking here. Those suites now look problems up by shape
 * (see `test/content-shapes.ts`); the shapes they need are asserted below, so
 * a deployment that stops providing one is told directly instead of finding
 * out through a kernel test failing for reasons that are not about the kernel.
 *
 * Facts particular to this competition — that the demo round is scored ACM
 * with twenty penalty minutes, that its window is in the past — are the second
 * half, and they belong here for the obvious reason.
 */

describe("内核测试需要的形状", () => {
  it("有一场按 group 限制参赛、且第一道题覆盖了 rateLimit 的比赛", () => {
    const round = allContests().find(
      (contest) =>
        contest.participants.mode === "group" &&
        contest.problems[0]?.rateLimit !== undefined,
    );
    expect(round, "submitFor 与 contestEntryFor 的用例靠它区分三种拒绝").toBeDefined();
  });

  it("有一道 retired 的题目", () => {
    const retired = allProblems().filter((problem) => problem.retired);
    expect(retired.length, "「题面可读但不收提交」这条轴需要一个活体").toBeGreaterThan(0);
  });

  it("有一道在役的、由后端评测的题目", () => {
    const external = externallyJudged().filter((problem) => !problem.retired);
    expect(external.length, "runner 领活的整条链路靠它").toBeGreaterThan(0);
  });

  it("有一道内联判题的题目", () => {
    const inline = allProblems().filter(
      (problem) => !problem.retired && isInlineBackend(problem.backend),
    );
    expect(inline.length, "提交当次同步判完这条路径靠它").toBeGreaterThan(0);
  });

  // 封榜赛制与声明了 actions 的题目不在这份清单上，尽管这套 content 两样都有。
  // 用到它们的两组用例各自开头就断言了自己遍历的集合非空——`freeze.test.ts` 与
  // `actions.test.ts`——那句话说得出「空在哪里」，这里再抄一遍只会多一处要跟着
  // 改的地方。这一节列的是内核用例向 content **索取样本**的那几样。

  it("有带能力的组", () => {
    const privileged = listGroups().filter(
      (group) => group.capabilities.length > 0,
    );
    expect(privileged.length, "每一条按能力取 viewer 的用例都靠它").toBeGreaterThan(0);
  });
});

describe("这套 content 自身自洽", () => {
  it("每道外挂题指向的后端都登记过", () => {
    expect(undeclaredBackends()).toEqual([]);
  });

  it("登记的后端都有题目路由过来", () => {
    // Not `orphanedBackends()`, which is the same question asked of the
    // registry: spelled out here so a failure names the entry.
    const routed = new Set(externallyJudged().map((p) => p.backend.id));
    for (const id of Object.keys(backends)) {
      expect(routed.has(id), `没有题目使用后端 ${id}`).toBe(true);
    }
  });

  it("开发环境把邮件打到控制台，而不是假装有 relay", () => {
    expect(enrollmentPolicy.mailDelivery).toBe("console");
  });
});

describe("演示赛", () => {
  const demo = contestBySlug("demo-acm");

  it("存在，并且 content/demo-data.sql 的种子提交挂得上", () => {
    expect(demo).toBeDefined();
  });

  it("用 acm 赛制，罚时二十分钟", () => {
    expect(demo?.ruleset.id).toBe("acm");
    expect(demo?.ruleset.config).toEqual({ penaltyMinutes: 20 });
  });

  it("题单里的每道题都真的存在", () => {
    for (const entry of demo?.problems ?? []) {
      expect(allProblems().some((p) => p.slug === entry.slug), entry.slug).toBe(
        true,
      );
    }
  });

  it("窗口在过去，seed 之后立刻有一张终榜可看", () => {
    expect(demo && demo.endsAt.getTime() < Date.now()).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { ActionId } from "@/lib/authz/actions";
import { allows, authorize } from "@/lib/authz/engine";
import { listGroups } from "@/lib/authz/groups";
import { actionsWithoutPermit, privilegedGroups } from "@/lib/authz/introspect";
import type { AccountRef } from "@/lib/authz/resources";
import { groupsFor } from "@/lib/enrollment/registry";
import { allContests, contestBySlug } from "@/lib/contests/registry";
import { mailSink } from "@/lib/mail/transport";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import { backends } from "@/lib/backend/registry";
import { undeclaredBackends } from "@/lib/backend/access";
import { viewsFor } from "@/lib/problems/views";
import { viewerFor } from "@/lib/authz/viewer";
import { viewerWith } from "@/test/content-shapes";

/**
 * Assertions about *this* deployment's content, kept out of the kernel suites.
 *
 * A fork owns this file the same way it owns the rest of `content/`: retire the
 * demo contest, drop a group, and the expectations here are the ones to edit.
 *
 * Helpers from `test/` are fair game — they resolve by action, not by name. What
 * no file under `lib/` or `test/` may do is spell these names out, which
 * `content-names.test.ts` enforces.
 */

describe("这套 content 自身自洽", () => {
  it("每道外挂题指向的后端都登记过", () => {
    expect(undeclaredBackends()).toEqual([]);
  });

  it("登记的后端都有题目路由过来", () => {
    const routed = new Set(externallyJudged().map((p) => p.backend.id));
    for (const id of Object.keys(backends)) {
      expect(routed.has(id), `没有题目使用后端 ${id}`).toBe(true);
    }
  });

  it("开发环境把邮件打到控制台，而不是假装有 relay", () => {
    expect(mailSink()).toBe("console");
  });

  it("在役的题都声明了上架日期", () => {
    const undated = allProblems()
      .filter((problem) => !problem.retired && !problem.addedAt)
      .map((problem) => problem.slug);

    expect(
      undated,
      "没声明 addedAt 的题会沉到「最新题目」末尾，等于永远不在首页露面",
    ).toEqual([]);
  });

  it("per-problem views.tsx 真的被 glob 自动发现了", () => {
    const declared = allProblems().filter(
      (problem) => viewsFor(problem.slug).PayloadView !== undefined,
    );
    expect(declared.length, "没有一道题拿到渲染，八成是 glob 没扫到").toBeGreaterThan(0);
  });
});

describe("这套 content 的策略集", () => {
  it("每个动作都至少有一条放行", () => {
    expect(
      actionsWithoutPermit(),
      "这些动作对所有人永远拒绝：要么忘了在 content/policies/ 里接上，要么最后一个放行它的策略被改掉了",
    ).toEqual([]);
  });

  it("有用户组被策略点名，否则运维台无人可进", () => {
    expect(privilegedGroups().size).toBeGreaterThan(0);
  });

  it("被点名的组都在 content/enrollment/ 里声明过", () => {
    const declared = new Set(listGroups().map((group) => group.id));
    for (const id of privilegedGroups()) {
      expect(
        declared.has(id),
        `content/policies/ 把权限给了 "${id}"，但 content/enrollment/ 没有声明它`,
      ).toBe(true);
    }
  });
});

describe("演示赛", () => {
  const demo = contestBySlug("demo-acm");

  it("存在，并且 scripts/demo-data.sql 的种子提交挂得上", () => {
    expect(demo).toBeDefined();
  });

  it("用 acm 赛制，罚时二十分钟", () => {
    const main = demo?.leaderboards[0];
    expect(main?.ruleset.id).toBe("acm");
    expect(main?.ruleset.config).toEqual({ penaltyMinutes: 20 });
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

  it("题单不为空，否则排行榜没有列", () => {
    expect(demo?.problems.length).toBeGreaterThan(0);
    expect(allContests().length).toBeGreaterThan(0);
  });
});

describe("演示账号", () => {
  const DEMO = "演示账号";

  const FROZEN = [
    "account.changeNickname",
    "account.changeAvatar",
    "account.changeUsername",
    "account.changeEmail",
    "account.changePassword",
    "account.sendPasswordReset",
    "account.resetPassword",
  ] as const satisfies readonly ActionId[];

  // uid 3 与 50 都不落在任何按 uid 分流的规则上，所以这里量到的就是邮箱规则本身。
  const demoGroups = groupsFor(3, "demo3@example.test");
  const plainGroups = groupsFor(50, "alice@example.test");

  function accountOf(
    uid: number,
    email: string,
    groups: readonly string[],
  ): AccountRef {
    return { uid, status: "active", email, emailVerified: true, groups };
  }

  it("scripts/demo-seed.cjs 建出来的账号会被打上标签", () => {
    expect(demoGroups).toContain(DEMO);
  });

  it("同时仍在 demo 组里，演示赛的参赛资格不受影响", () => {
    expect(demoGroups).toContain("demo");
  });

  it("同域的普通账号不会被误伤", () => {
    expect(plainGroups).not.toContain(DEMO);
  });

  it("改不动自己的资料与密码，找回密码流程也对它关闭", () => {
    const account = accountOf(3, "demo3@example.test", demoGroups);
    const self = viewerFor({ uid: 3, groups: demoGroups });

    for (const action of FROZEN) {
      expect(authorize(action, account, self), action).toMatchObject({
        allow: false,
        via: "demo:frozen-credentials",
      });
    }
  });

  it("同样这些动作，普通账号照常放行", () => {
    const account = accountOf(50, "alice@example.test", plainGroups);
    const self = viewerFor({ uid: 50, groups: plainGroups });

    for (const action of FROZEN) {
      expect(allows(action, account, self), action).toBe(true);
    }
  });

  it("封不掉，连能封禁别人的人也封不掉它", () => {
    const account = accountOf(3, "demo3@example.test", demoGroups);

    expect(
      authorize("account.suspend", account, viewerWith("account.suspend")),
    ).toMatchObject({ allow: false, via: "demo:no-suspend" });
  });

  it("普通账号仍然封得掉，没有把封禁整条压死", () => {
    const account = accountOf(50, "alice@example.test", plainGroups);

    expect(
      allows("account.suspend", account, viewerWith("account.suspend")),
    ).toBe(true);
  });
});

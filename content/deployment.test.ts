import { describe, expect, it } from "vitest";
import type { ActionId } from "@/lib/authz/actions";
import { allows, authorize } from "@/lib/authz/engine";
import { listGroups } from "@/lib/authz/groups";
import { actionsWithoutPermit, privilegedGroups } from "@/lib/authz/introspect";
import type { AccountRef } from "@/lib/authz/resources";
import { groupsFor } from "@/lib/enrollment/registry";
import { isCatalogue } from "@/lib/contests/catalogue";
import {
  allContests,
  catalogueContests,
  contestBySlug,
} from "@/lib/contests/registry";
import { mailSink } from "@/lib/mail/transport";
import { site } from "@/lib/site";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import { backends } from "@/lib/backend/registry";
import { undeclaredBackends } from "@/lib/backend/access";
import { viewsFor } from "@/lib/problems/views";
import { listRulesets } from "@/lib/standings/registry";
import { viewerFor } from "@/lib/authz/viewer";
import { viewerWith } from "@/test/content-shapes";
import { ignoresLateSubmissions } from "@/test/standings-support";

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

  it("每道题都被某场比赛带着，否则它没有任何 URL", () => {
    const carried = new Set(
      allContests().flatMap((contest) =>
        contest.problems.map((entry) => entry.slug),
      ),
    );
    const orphans = allProblems()
      .map((problem) => problem.slug)
      .filter((slug) => !carried.has(slug));

    expect(orphans, "题目只能作为比赛的所属物被打开").toEqual([]);
  });

  it("per-problem views.tsx 真的被 glob 自动发现了", () => {
    const declared = allProblems().filter(
      (problem) => viewsFor(problem.slug).PayloadView !== undefined,
    );
    expect(declared.length, "没有一道题拿到渲染，八成是 glob 没扫到").toBeGreaterThan(0);
  });
});

describe("这套 content 的赛制", () => {
  it("每一套都无视比赛窗口之外的提交", () => {
    expect(listRulesets().length).toBeGreaterThan(0);

    for (const ruleset of listRulesets()) {
      const { onTime, withLate } = ignoresLateSubmissions(ruleset);
      expect(
        withLate,
        `${ruleset.id} 把赛后提交算进了名次：afterEnd.submissions 的比赛会被它污染终榜`,
      ).toEqual(onTime);
    }
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

describe("题库", () => {
  const sections = catalogueContests();

  it("site.catalogue 指名的比赛都存在，/problems 才有卡片可摆", () => {
    expect(site.catalogue?.length).toBeGreaterThan(0);
    expect(sections.map((contest) => contest.slug)).toEqual(site.catalogue);
  });

  it("每个分区的窗口都横跨当下，任何人随时都能提交", () => {
    const now = Date.now();

    for (const contest of sections) {
      expect(contest.startsAt.getTime(), contest.slug).toBeLessThan(now);
      expect(contest.endsAt.getTime(), contest.slug).toBeGreaterThan(now);
      expect(contest.participants.mode, contest.slug).toBe("open");
    }
  });

  it("已经开张的分区带着题；空分区是预留的方向", () => {
    const reserved = [
      "comm",
      "framework",
      "inference",
      "cluster",
      "pwn",
      "reverse",
      "crypto",
      "misc",
    ];

    for (const contest of sections) {
      if (reserved.includes(contest.slug)) {
        expect(contest.problems, contest.slug).toEqual([]);
        continue;
      }
      expect(contest.problems.length, contest.slug).toBeGreaterThan(0);
    }
  });

  it("每个分区都点了名维度，否则筛选栏与徽章一起消失", () => {
    for (const contest of sections) {
      expect(contest.facets.length, contest.slug).toBeGreaterThan(0);
    }
  });

  it("分区归在不止一个领域下，索引页才是分组的", () => {
    const domains = sections.map((contest) => contest.domain);

    expect(domains.filter((domain) => domain === undefined)).toEqual([]);
    expect(new Set(domains).size).toBeGreaterThan(1);
  });

  it("有一个领域下挂着不止一个分区", () => {
    const perDomain = new Map<string, number>();
    for (const contest of sections) {
      const domain = contest.domain!;
      perDomain.set(domain, (perDomain.get(domain) ?? 0) + 1);
    }

    expect([...perDomain.values()].filter((count) => count > 1).length)
      .toBeGreaterThan(0);
  });

  it("题库之外还有别的比赛，/contests 才不是空页", () => {
    expect(
      allContests().filter((contest) => !isCatalogue(contest.slug)).length,
    ).toBeGreaterThan(0);
  });

  it("正式轮次一个维度都不点名，赛中不泄露难度与标签", () => {
    for (const contest of allContests()) {
      if (isCatalogue(contest.slug)) continue;
      expect(contest.facets, contest.slug).toEqual([]);
    }
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

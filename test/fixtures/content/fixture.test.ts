import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { site } from "@/lib/site";
import { listGroups } from "@/lib/authz/groups";
import { privilegedGroups } from "@/lib/authz/introspect";
import { viewerFor } from "@/lib/authz/viewer";
import { allContests } from "@/lib/contests/registry";
import { backends } from "@/lib/backend/registry";
import { undeclaredBackends } from "@/lib/backend/access";
import { problemsFor } from "@/lib/problems/access";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import { isInlineBackend } from "@/lib/problems/types";
import { listRulesets } from "@/lib/standings/registry";
import {
  input,
  participants,
  problem as standingsProblem,
  solve,
} from "@/test/standings-support";

/**
 * What the kernel tests assume about the content behind them.
 *
 * They resolve to this fixture, not to `content/`, so that a deployment may
 * delete a group or a contest without breaking tests that are about the
 * platform. That freedom costs this file: whoever edits the fixture has to keep
 * these shapes alive, and finds out here rather than in an unrelated suite.
 */
describe("夹具供给了内核测试要的形状", () => {
  it("一场按 group 限制参赛、且第一道题覆盖了 rateLimit 的比赛", () => {
    const round = allContests().find(
      (contest) =>
        contest.participants.mode === "group" &&
        contest.problems[0]?.rateLimit !== undefined,
    );
    expect(round, "submitFor 与 contestEntryFor 靠它区分三种拒绝").toBeDefined();
  });

  it("一场谁都看不到的暂存轮次", () => {
    const staged = allContests().filter(
      (contest) => contest.visibleTo?.length === 0,
    );
    expect(
      staged.length,
      "没有它，「能预览的人拿到全部比赛」与「所有人拿到全部比赛」无法区分",
    ).toBeGreaterThan(0);
  });

  it("一道下架的题", () => {
    expect(
      allProblems().filter((problem) => problem.retired).length,
      "「题面可读但不收提交」这条轴需要一个活体",
    ).toBeGreaterThan(0);
  });

  it("一道在役的、由后端评测的题", () => {
    expect(
      externallyJudged().filter((problem) => !problem.retired).length,
      "runner 领活的整条链路靠它",
    ).toBeGreaterThan(0);
  });

  it("一道内联判题的题", () => {
    expect(
      allProblems().filter(
        (problem) => !problem.retired && isInlineBackend(problem.backend),
      ).length,
      "提交当次同步判完这条路径靠它",
    ).toBeGreaterThan(0);
  });

  it("一道限定受众的题", () => {
    expect(
      allProblems().filter((problem) => problem.visibleTo?.length).length,
      "受众不通过的用例需要一道真的会拒绝人的题",
    ).toBeGreaterThan(0);
  });

  it("一道不属于任何比赛的公开题", () => {
    const contest = allContests()[0];
    expect(contest).toBeDefined();

    const listed = new Set(contest!.problems.map((entry) => entry.slug));
    const outside = problemsFor(
      viewerFor(null),
      new Date(contest!.startsAt.getTime() + 1),
    )
      .map((view) => view.config)
      .find((config) => !listed.has(config.slug));

    expect(outside, "赛外提交路径需要一道不在赛里的公开题").toBeDefined();
  });

  it("一个在役题目上声明过的、带自有配额的交互 action", () => {
    const own = externallyJudged()
      .filter((problem) => !problem.retired)
      .flatMap((problem) =>
        Object.values(problem.backend.actions).filter((spec) => spec.rateLimit),
      );
    expect(own.length, "配额来自声明还是来自默认值，靠它区分").toBeGreaterThan(0);
  });

  it("一个下架题目上声明过的交互 action", () => {
    const retired = externallyJudged()
      .filter((problem) => problem.retired)
      .flatMap((problem) => Object.keys(problem.backend.actions));
    expect(
      retired.length,
      "下架挡的是 submit 也是 invoke，没有它后半句没被验证",
    ).toBeGreaterThan(0);
  });

  it("一种 Cell 含 pending 字段的赛制", () => {
    const base = input({
      participants: participants(1),
      problems: [standingsProblem("a", "A")],
      submissions: [solve(1, "a", 10)],
    });

    const withPending = listRulesets().filter((ruleset) => {
      const cell = ruleset.compute(base).rows[0]?.cells["a"];
      return typeof (cell as Record<string, unknown> | undefined)?.pending === "number";
    });

    expect(withPending.length, "封榜的 pending 语义要有赛制来承接").toBeGreaterThan(0);
  });

  it("被策略点名的用户组", () => {
    expect(
      privilegedGroups().size,
      "每一条按动作取 viewer 的用例都靠它",
    ).toBeGreaterThan(0);
  });

  it("被点名的组都声明过", () => {
    const declared = new Set(listGroups().map((group) => group.id));
    for (const id of privilegedGroups()) {
      expect(declared.has(id), `策略把权限给了 "${id}"，但没有声明它`).toBe(true);
    }
  });
});

describe("夹具自身自洽", () => {
  it("每道外挂题指向的后端都登记过", () => {
    expect(undeclaredBackends()).toEqual([]);
  });

  it("登记的后端都有题目路由过来", () => {
    const routed = new Set(externallyJudged().map((problem) => problem.backend.id));
    for (const id of Object.keys(backends)) {
      expect(routed.has(id), `没有题目使用后端 ${id}`).toBe(true);
    }
  });
});

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The specifiers `vitest.config.mts` redirects here. */
const REDIRECTED = new Set([
  "@/content/site",
  "@/content/site-views",
  "@/content/backends",
  "@/content/schema",
  "@/content/_modules/contests",
  "@/content/_modules/emails",
  "@/content/_modules/enrollment",
  "@/content/_modules/policies",
  "@/content/_modules/problem-views",
  "@/content/_modules/problems",
  "@/content/_modules/rulesets",
]);

const FIXTURE_DIR = join("test", "fixtures");

/** Kernel suites: those specifiers land on the fixture, anything else is a leak. */
const AGAINST_FIXTURE = ["app", "components", "lib", "test", "views"];

/**
 * The `tools` project redirects nothing, so for tests under `scripts/` even the
 * entry points reach the real deployment. Tooling carries its own samples.
 */
const AGAINST_NOTHING = ["scripts"];

function testsIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const path = join(dir, entry.name);
    if (path.slice(ROOT.length).startsWith(FIXTURE_DIR)) continue;

    if (entry.isDirectory()) testsIn(path, found);
    else if (/\.test\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

const IMPORT = /from\s+["']([^"']+)["']/g;

describe("内核测试跑在夹具上", () => {
  it("站点配置来自夹具，说明入口真的被改道了", () => {
    expect(
      site.name,
      "解析回了 content/：alias 没生效，内核测试又绑上了这套部署",
    ).toBe("Fixture");
  });

  it("content/ 之外没有一份测试直接伸进 content/", () => {
    const offences: string[] = [];

    const scan = (dir: string, redirected: boolean) => {
      for (const path of testsIn(join(ROOT, dir))) {
        const source = readFileSync(path, "utf8");
        for (const [, specifier] of source.matchAll(IMPORT)) {
          const reachesContent =
            specifier!.startsWith("@/content/") ||
            /(^|\/)content\//.test(specifier!);
          if (!reachesContent) continue;
          if (redirected && REDIRECTED.has(specifier!)) continue;

          offences.push(`${path.slice(ROOT.length)}: ${specifier}`);
        }
      }
    };

    for (const dir of AGAINST_FIXTURE) scan(dir, true);
    for (const dir of AGAINST_NOTHING) scan(dir, false);

    expect(
      offences,
      "只有 deployment project（content/**/*.test.ts）该读 content/。" +
        "内核测试要什么形状就向 test/content-shapes.ts 要，由夹具供给；" +
        "scripts/ 下的工具测试则该自带样例——直接导入 content/ 会让这套部署" +
        "删掉一个组就把不相干的测试弄红",
    ).toEqual([]);
  });
});

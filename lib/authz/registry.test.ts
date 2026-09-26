import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_ROOTS, SLOT_ROOTS } from "@/test/content-roots.mjs";
import { nodes, parseSource, walk } from "@/test/source";
import { policy } from "./types";

const ROOT = join(import.meta.dirname, "..", "..");
const KERNEL = join("lib", "authz");

function key(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

/** Policies are where authorization logic belongs; they are not a bypass. */
const POLICIES = CONTENT_ROOTS.map((root) => join(root, "policies"));

const SCANNED = ["app", "lib", ...SLOT_ROOTS];

function sources(...directories: string[]): string[] {
  return directories
    .flatMap((directory) => walk(join(ROOT, directory)))
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => {
      const path = relative(ROOT, file);
      return (
        !path.startsWith(KERNEL) &&
        !POLICIES.some((policies) => path.startsWith(policies))
      );
    });
}

/**
 * Deciding what a resource attribute means is the kernel's job, with one
 * exception: the readers of a config's own shape live next to that shape and
 * are consumed by the builtin policies.
 */
const ATTRIBUTE_READERS: Record<string, string> = {
  "lib/contests/types.ts":
    "contestPhase / matchesParticipants 解释比赛配置自身的字段，由 builtin 策略消费",
};

function bypassCalls(source: string): string[] {
  return nodes(parseSource(source), ts.isCallExpression).flatMap((call) => {
    const callee = call.expression;
    if (ts.isIdentifier(callee) && ["inAudience", "requireCapability", "capabilitiesOf"].includes(callee.text)) return [callee.text];
    if (!ts.isPropertyAccessExpression(callee)) return [];
    if (callee.name.text === "can" && call.arguments[0] && ts.isStringLiteralLike(call.arguments[0])) return ["viewer.can"];
    if (callee.name.text === "includes" && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === "groups") return ["groups.includes"];
    return [];
  });
}

function bypasses(): string[] {
  return sources(...SCANNED).flatMap((file) => {
    const path = key(file);
    if (path in ATTRIBUTE_READERS) return [];

    return bypassCalls(readFileSync(file, "utf8")).map((what) => `${path}: ${what}`);
  });
}

describe("策略注册校验", () => {
  const valid = policy({ id: "test:permit", effect: "permit", describe: "测试放行", action: "admin.enter" });
  const conditional = policy({ id: "test:conditional", effect: "permit", describe: "条件读取", action: "submission.read", when: () => true });
  const reason = { code: "test-denied", message: "测试拒绝" };

  async function registry(policies: unknown) {
    vi.resetModules();
    vi.doMock("@/content/_modules/policies", () => ({ policyModules: { "test/policies.ts": { policies } } }));
    return import("./registry");
  }

  afterEach(() => {
    vi.doUnmock("@/content/_modules/policies");
    vi.resetModules();
  });

  it.each([
    { name: "重复 id", policies: [valid, valid], error: "重复声明" },
    { name: "空说明", policies: [{ ...valid, describe: "" }], error: "不合法" },
    { name: "放行策略带拒绝理由", policies: [{ ...valid, reason }], error: "不合法" },
    { name: "未知动作", policies: [{ ...valid, actions: ["unknown.action"] }], error: "不合法" },
    { name: "有条件的查询缺少 filter", policies: [conditional], error: "必须同时给出 filter" },
    { name: "导出不是数组", policies: valid, error: "必须是数组" },
  ])("拒绝$name", async ({ policies, error }) => {
    const { assertPolicyRegistry } = await registry(policies);
    expect(assertPolicyRegistry).toThrow(error);
  });

  it("接受带 filter 的条件查询及带理由的拒绝策略，并按动作索引", async () => {
    const readable = { ...conditional, filter: () => undefined };
    const forbidden = { ...valid, id: "test:forbid", effect: "forbid", reason };
    const { assertPolicyRegistry, policiesFor } = await registry([readable, forbidden]);
    expect(assertPolicyRegistry).not.toThrow();
    expect(policiesFor("submission.read")).toContainEqual(readable);
    expect(policiesFor("admin.enter")).toContainEqual(forbidden);
    expect(policiesFor("submission.read")).not.toContainEqual(forbidden);
  });
});

describe("没有绕过内核的判断", () => {
  it("内核之外没有人自己回答「他能不能」", () => {
    expect(
      bypasses(),
      "授权只有一个入口 lib/authz/engine.ts#authorize；" +
        "要读资源属性，把它写成 lib/authz/builtin.ts 里的一条策略",
    ).toEqual([]);
  });

  it("扫描确实找到了东西，而不是路径写错后空过", () => {
    expect(sources(...SCANNED).length).toBeGreaterThan(0);
  });

  it("检查实际调用，允许注释、字符串及空格变化", () => {
    expect(bypassCalls(`
      // viewer.can('example');
      const example = "viewer.groups.includes('group')";
      viewer.groups.includes /* comment */ ('group');
      inAudience (audience, viewer);
    `)).toEqual(["groups.includes", "inAudience"]);
  });
});

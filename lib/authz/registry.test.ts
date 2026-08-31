import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_ROOTS, SLOT_ROOTS } from "@/test/content-roots.mjs";
import { ACTION_IDS, isQueryable } from "./actions";
import { actionsWithoutPermit, privilegedGroups } from "./introspect";
import { allPolicies } from "./registry";

const ROOT = join(import.meta.dirname, "..", "..");
const KERNEL = join("lib", "authz");

/**
 * The authorization kernel is only worth having if nothing routes around it.
 * These guards read the policy set as data and the rest of the tree as text,
 * so a gate that grows back by hand fails here rather than in production.
 */

/** Absent is fine: none of the fork's slots exist upstream. */
function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function key(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
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

/** Ways of answering "may they" that must not reappear outside the kernel. */
const BYPASSES: { pattern: RegExp; what: string }[] = [
  { pattern: /\.can\(\s*["']/, what: "viewer.can(…)" },
  { pattern: /\binAudience\(/, what: "inAudience(…)" },
  { pattern: /\.groups\.includes\(/, what: "groups.includes(…)" },
  { pattern: /\brequireCapability\(/, what: "requireCapability(…)" },
  { pattern: /\bcapabilitiesOf\(/, what: "capabilitiesOf(…)" },
];

function bypasses(): string[] {
  return sources(...SCANNED).flatMap((file) => {
    const path = key(file);
    if (path in ATTRIBUTE_READERS) return [];

    const source = withoutComments(readFileSync(file, "utf8"));
    return BYPASSES.filter(({ pattern }) => pattern.test(source)).map(
      ({ what }) => `${path}: ${what}`,
    );
  });
}

describe("策略集", () => {
  it("每个动作都至少有一条放行", () => {
    expect(
      actionsWithoutPermit(),
      "这些动作对所有人永远拒绝：要么忘了在 content/policies/ 里接上，要么最后一个放行它的策略被改掉了",
    ).toEqual([]);
  });

  it("策略 id 全局唯一", () => {
    const ids = allPolicies().map((entry) => entry.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("每条策略都写了中文说明", () => {
    const silent = allPolicies()
      .filter((entry) => entry.describe.trim().length === 0)
      .map((entry) => entry.id);

    expect(silent, "运维台会把 describe 列出来，空的等于没解释").toEqual([]);
  });

  it("只有 forbid 带拒绝理由", () => {
    const wrong = allPolicies()
      .filter((entry) => entry.effect === "permit" && entry.reason)
      .map((entry) => entry.id);

    expect(wrong).toEqual([]);
  });

  it("成批取行的动作，带条件的策略都给了 filter", () => {
    const missing = allPolicies()
      .filter((entry) => entry.when && !entry.filter)
      .filter((entry) => entry.actions.some(isQueryable))
      .map((entry) => entry.id);

    expect(
      missing,
      "这些动作要从数据库里成批取行，只会回答单行的策略会在列表里静默失效",
    ).toEqual([]);
  });

  it("有用户组被策略点名，否则运维台无人可进", () => {
    expect(privilegedGroups().size).toBeGreaterThan(0);
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
    expect(sources(...SCANNED).length).toBeGreaterThan(
      100,
    );
    expect(allPolicies().length).toBeGreaterThanOrEqual(ACTION_IDS.length / 2);
  });
});

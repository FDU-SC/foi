import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGroups } from "@/lib/authz/groups";
import { backends } from "@/lib/backend/registry";
import { allContests } from "@/lib/contests/registry";
import { allProblems } from "@/lib/problems/registry";
import { listRulesets } from "@/lib/standings/registry";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SKIP = new Set([
  ".git",
  ".next",
  "content",
  "coverage",
  "drizzle",
  "node_modules",
  "public",
]);

/** Another content set, judged by its own rules rather than as kernel source. */
const SKIP_PATHS = new Set(["test/fixtures"]);

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

const LITERAL = /(["'])([^"'\n]*)\1/g;

const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;

    const path = join(dir, entry.name);
    if (SKIP_PATHS.has(path.slice(ROOT.length))) continue;

    if (entry.name === "content") {
      const modulesDir = join(path, "_modules");
      try {
        for (const file of readdirSync(modulesDir)) {
          if (SOURCE.test(file)) found.push(join(modulesDir, file));
        }
      } catch {}
      continue;
    }

    // Operator scripts run against a real deployment, so naming its problems and
    // groups is their job. Their tests have no such excuse.
    if (entry.name === "scripts") {
      for (const file of readdirSync(path)) {
        if (/\.test\.tsx?$/.test(file)) found.push(join(path, file));
      }
      continue;
    }

    if (SKIP.has(entry.name)) continue;

    if (entry.isDirectory()) sourceFiles(path, found);
    else if (SOURCE.test(entry.name)) found.push(path);
  }
  return found;
}

function contentNames(): Map<string, string> {
  const names = new Map<string, string>();
  const add = (kind: string, values: string[]) => {
    for (const value of values) names.set(value, kind);
  };

  add("题目 slug", allProblems().map((problem) => problem.slug));
  add("比赛 slug", allContests().map((contest) => contest.slug));
  add("赛制 id", listRulesets().map((ruleset) => ruleset.id));
  add("后端 id", Object.keys(backends));
  add("用户组 id", listGroups().map((group) => group.id));

  return names;
}

/**
 * Runs against the deployment's own content, so a fork gets the check that
 * matters to it: nothing in `lib/`, `app/` or `components/` may hardcode a name
 * this deployment chose.
 */
describe("内核不认识 content 的名字", () => {
  it("没有一份内核源码把某个 content 的名字写成字面量", () => {
    const names = contentNames();
    const offences: string[] = [];

    for (const path of sourceFiles(ROOT)) {
      const lines = readFileSync(path, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (COMMENT.test(line)) continue;
        for (const [, , literal] of line.matchAll(LITERAL)) {
          const kind = names.get(literal!);
          if (kind === undefined) continue;
          offences.push(
            `${path.slice(ROOT.length)}:${index + 1} 写死了${kind}「${literal}」`,
          );
        }
      }
    }

    expect(
      offences,
      "内核提到了 content 里的一个名字。要么把它换成按形状或按契约取值，" +
        "要么——如果这个名字撞的是内核本来就在用的普通词——给 content 换个 id。",
    ).toEqual([]);
  });

  it("确实拿到了一批名字，否则上一条是空真", () => {
    expect(contentNames().size).toBeGreaterThan(0);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGroups } from "@/lib/authz/groups";
import { backends } from "@/lib/backend/registry";
import { allContests } from "@/lib/contests/registry";
import { allProblems } from "@/lib/problems/registry";
import { listRulesets } from "@/lib/standings/registry";
import { isContentRoot } from "@/test/content-roots.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SKIP = new Set([
  ".git",
  ".next",
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A quoted content name is a hardcode only when the kernel uses it to pick
 * an entity: comparing a slug or group, calling a BySlug helper, or writing
 * a catalogue path. A word that already appears in a kernel type or guard
 * is the kernel's own vocabulary.
 */
function namesEntity(line: string, name: string): boolean {
  const id = escapeRegExp(name);
  return [
    String.raw`(?:slug|id|group)\s*(?:[=!]==?|:)\s*["']${id}["']`,
    String.raw`(?:BySlug|isCatalogue|contestHref|problemHref|standingsHref)\(\s*["']${id}["']`,
    String.raw`["']/(?:problems|contests)/${id}(?:/|["'])`,
    String.raw`groups\.includes\(\s*["']${id}["']`,
  ].some((pattern) => new RegExp(pattern).test(line));
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;

    const path = join(dir, entry.name);
    if (SKIP_PATHS.has(path.slice(ROOT.length))) continue;

    // A content root contributes only its `_modules/` shim: that shim faces the
    // platform, so it may not name what it re-exports.
    if (isContentRoot(entry.name)) {
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
          if (!namesEntity(line, literal!)) continue;
          offences.push(
            `${path.slice(ROOT.length)}:${index + 1} 写死了${kind}「${literal}」`,
          );
        }
      }
    }

    expect(
      offences,
      "内核按名字点了 content 里的一个实体。换成按形状或按契约取值。",
    ).toEqual([]);
  });

  it("确实拿到了一批名字，否则上一条是空真", () => {
    expect(contentNames().size).toBeGreaterThan(0);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGroups } from "@/lib/auth/groups";
import { backends } from "@/lib/backend/registry";
import { allContests } from "@/lib/contests/registry";
import { allProblems } from "@/lib/problems/registry";
import { listRulesets } from "@/lib/standings/registry";

/**
 * That no file outside `content/` says the name of anything inside it.
 *
 * The companion to `test/content-shapes.ts`, and the two of them are the whole
 * contract: the kernel may require a *shape* and must not know a *name*. A
 * platform that mentions `demo-acm` is not a platform, it is this competition
 * with an abstraction on top, and the failure mode is silent — everything
 * passes here and breaks in somebody else's checkout.
 *
 * This used to be checked by running the whole suite against a second set of
 * content: swap `content/` for a skeleton whose names all differed, and a
 * hardcoded slug turned red. That worked, and it cost a full job — typecheck,
 * lint, test, build and smoke — to answer one question, while leaving the
 * skeleton itself to be maintained as a shadow deployment. Asking the question
 * directly costs a second, and says which line rather than which step.
 *
 * What it cannot do is see through indirection: a name assembled from pieces,
 * or read out of an environment variable, passes. That is a real gap and the
 * swap did not have it. It is judged an acceptable trade because every
 * instance this repository has actually grown — `import "@/content/emails"`,
 * `contestBySlug("demo-acm")`, a leak probe spelling out one problem's answer,
 * a backend roster copied into six files — was a literal.
 *
 * With no `content/` mounted there are no names, and this passes vacuously.
 * That is correct: the claim is about the kernel's relationship to content it
 * has, and `content-absent` is where the no-content claim is checked.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * `content/` is excluded because naming its own problems is its job, and
 * `test/content-skeleton/` for exactly the same reason — it is content as
 * well, mounted by a different job. `drizzle/` holds generated SQL, `public/`
 * is not source.
 */
const SKIP = new Set([
  ".git",
  ".next",
  "content",
  "content-skeleton",
  "coverage",
  "drizzle",
  "node_modules",
  "public",
]);

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * A whole quoted string, so a name only counts when it is the entire literal.
 * `id: "acm"` is a mention; a group called `text` does not indict every
 * `className="text-fg"` in the tree.
 */
const LITERAL = /(["'])([^"'\n]*)\1/g;

/**
 * Lines that are commentary. Prose is allowed to discuss `traditional` or
 * recount what `contestBySlug("demo-acm")` used to do — that history is worth
 * keeping, and it compiles to nothing.
 *
 * Trailing comments are not detected, which would matter if anybody wrote a
 * content name in one. Nobody has, and the alternative is a parser.
 */
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP.has(entry.name)) continue;

    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (SOURCE.test(entry.name)) found.push(path);
  }
  return found;
}

/** Every name this deployment coined, and what kind of thing it names. */
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
    // The check above is a search for a needle, so it passes trivially when
    // there are no needles. A tree with no `content/` trips `content-shapes`
    // as well, and that failure explains itself better than this one.
    expect(contentNames().size).toBeGreaterThan(0);
  });
});

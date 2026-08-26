import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/auth/policy";
import {
  PAGE_CHECKS,
  READ_GATES,
  WRITE_GATES,
  type Denied,
  type Gate,
} from "./enforcement";

/**
 * The two tables widened off their literal types, so that optional fields are
 * readable and a comparison against a `Denied` value neither table happens to
 * use is a question rather than a type error.
 */
const READS: Record<string, Gate> = READ_GATES;
const WRITES: Record<string, Gate> = WRITE_GATES;

/** Both under one key space. */
const ALL_GATES: Record<string, Gate> = { ...READS, ...WRITES };

/**
 * What stops the map becoming a snapshot of one afternoon.
 *
 * `./enforcement` is documentation — nothing reads it at runtime, on purpose,
 * so nothing about writing a new access layer would make it fail to compile.
 * That leaves this file as the only thing standing between the map and rot,
 * and it checks the two directions separately because they catch different
 * mistakes:
 *
 * - Add a gate and forget the map, and the map is *incomplete* — the failure
 *   mode that makes an index worthless, since a reader cannot tell a short
 *   list from a complete one.
 * - Add a capability and forget to ask it anywhere, and the vocabulary has a
 *   dead word in it. So does removing the last place that asked one. Both read
 *   as "we have a control for this" when there is nothing behind it.
 *
 * Deliberately a source-text scan rather than importing the modules, the same
 * choice `lib/ratelimit/policy.test.ts` made and for the same reason: half
 * these modules reach the database at import, and a test that needs a
 * `DATABASE_URL` to ask which functions a file exports is a test that gets
 * skipped.
 */

/**
 * The repository root, which every path below is relative to — the map keys
 * read `lib/<resource>/access.ts#<function>`, and the scan has to produce the
 * same spelling. One level up from `test/`, and the assertion at the bottom of
 * this file is what keeps a wrong answer here from passing as a clean run.
 */
const ROOT = join(import.meta.dirname, "..");

/**
 * The kernel is skipped by every scan below.
 *
 * `lib/auth/` owns the vocabulary, the viewer and the primitives the gates are
 * built out of, and owns no resource — so it can hold no gate, and the
 * `viewer.can("…")` spellings in it are documentation of how to write one.
 */
const KERNEL = join("lib", "auth");

/**
 * Comments are stripped before scanning, because this file's own prose is full
 * of `viewer.can("…")` and so is `lib/auth/policy.ts`'s. The naive stripper
 * can eat the tail of a line whose string literal contains `//`; that can only
 * lose a detection, never invent one, which is the right way round for a scan
 * whose failures edit the map.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

/** Posix-spelled and repository-relative, matching how the map keys read. */
function key(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

function sources(...directories: string[]): string[] {
  return directories
    .flatMap((directory) => walk(join(ROOT, directory)))
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => !relative(ROOT, file).startsWith(KERNEL));
}

/**
 * Where the `(` at `openAt` closes, counted rather than matched.
 *
 * `[^)]*` would stop at the first `)`, and several of these signatures end
 * `now = new Date()`.
 */
function closingParen(source: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The text between a function's parentheses. */
function parameters(source: string, openAt: number): string {
  const close = closingParen(source, openAt);
  return close === -1 ? "" : source.slice(openAt + 1, close);
}

/**
 * The declared return type, from the closing `)` up to the body.
 *
 * Leans on formatting rather than parsing TypeScript, and on one fact in
 * particular: Prettier breaks the line straight after the brace that opens a
 * block, so the body's `{` is the first one followed by a newline. The angle
 * depth is what keeps `Promise<{` from being mistaken for it, since that is
 * the other brace in a signature a line break can follow.
 */
function returnType(source: string, openAt: number): string {
  const close = closingParen(source, openAt);
  if (close === -1) return "";

  const opensBody = (at: number): boolean =>
    source[at] === "{" && /^[^\S\n]*\n/.test(source.slice(at + 1));

  let angle = 0;
  for (let i = close + 1; i < source.length; i += 1) {
    if (source[i] === "<") angle += 1;
    else if (source[i] === ">" && source[i - 1] !== "=") angle -= 1;
    else if (angle === 0 && opensBody(i)) {
      return source.slice(close + 1, i).trim();
    }
  }
  return "";
}

/**
 * What each refusal shape promises the declaration will admit.
 *
 * `denied` is the one column a reader cannot check for themselves — its own
 * note says why, since `T | null` and `T | undefined` are the same thing from
 * the far side of an `await` — so it is checked against the signature here
 * instead.
 *
 * Only the values naming a literal appear. `tagged-reason`, `redacted`,
 * `empty-object` and `public-variant` are claims about the *contents* of a
 * value the signature does not distinguish, and a pattern pretending to check
 * one of those would read like coverage while asserting nothing.
 *
 * Which means the entry that prompted this column being audited at all —
 * `standingsFor`, which claimed `null` while in fact answering everybody with
 * a board — is not the one this assertion catches. Its corrected value is
 * `public-variant`, on the unlistable side of that split, and its old `null`
 * would have passed too: the signature really is `ContestStandings | null`,
 * for a slug that names no contest. That entry rests on the prose above it
 * instead. What is mechanised here is the narrower promise that a declaration
 * naming a literal names one the function can actually return, which is
 * enough to catch the same mistake wherever the shape is legible.
 */
const DENIED_ADMITS: Partial<Record<Denied, RegExp>> = {
  undefined: /\bundefined\b/,
  null: /\bnull\b/,
  false: /\bboolean\b/,
  "empty-array": /\[\]/,
  "filtered-out": /\[\]/,
};

/**
 * Exported functions under `lib/` that take somebody's identity.
 *
 * That signature is the definition of a gate here, rather than living in a
 * file called `access.ts`: two of the real ones do not, and neither is
 * misplaced — see the note at the top of `./enforcement`. `ResolvedUser`
 * counts alongside `Viewer` because entry to a contest needs an account rather
 * than a capability holder.
 */
function declaredGates(): { key: string; file: string; returns: string }[] {
  return sources("lib").flatMap((file) => {
    const source = code(readFileSync(file, "utf8"));
    return [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)]
      .map((match) => ({ match, open: match.index + match[0].length - 1 }))
      .filter(({ open }) =>
        /\b(?:Viewer|ResolvedUser)\b/.test(parameters(source, open)),
      )
      .map(({ match, open }) => ({
        key: `${key(file)}#${match[1]}`,
        file,
        returns: returnType(source, open),
      }));
  });
}

interface Action {
  name: string;
  file: string;
  /** The capability its `requireCapability` names, or null when it has none. */
  capability: string | null;
}

/**
 * Server Actions, sliced apart so each one's `requireCapability` is attributed
 * to the function it actually guards rather than to the file.
 */
function declaredActions(): Action[] {
  return sources("app").flatMap((file) => {
    const source = code(readFileSync(file, "utf8"));
    if (!/^\s*["']use server["']/m.test(source)) return [];

    const exports = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)];
    return exports.map((match, index) => {
      const body = source.slice(
        match.index,
        exports[index + 1]?.index ?? source.length,
      );
      return {
        name: match[1],
        file: key(file),
        capability:
          /requireCapability\(\s*["']([^"']+)["']/.exec(body)?.[1] ?? null,
      };
    });
  });
}

/** Files asking `viewer.can("…")` somewhere other than inside a read gate. */
function checksOutsideGates(): { file: string; capability: string }[] {
  const gateFiles = new Set(
    Object.keys(READ_GATES).map((entry) => entry.split("#")[0]),
  );

  return sources("app", "components", "lib")
    .concat(join(ROOT, "proxy.ts"))
    .filter((file) => !gateFiles.has(key(file)))
    .flatMap((file) => {
      const source = code(readFileSync(file, "utf8"));
      return [...source.matchAll(/\.can\(\s*["']([^"']+)["']/g)].map(
        (match) => ({ file: key(file), capability: match[1] }),
      );
    });
}

describe("授权地图", () => {
  it("每个取函数都在地图里登记过", () => {
    const missing = declaredGates()
      .filter((gate) => !(gate.key in READ_GATES))
      .map((gate) => gate.key);

    expect(
      missing,
      "新增了收 Viewer / ResolvedUser 的导出，但没有在 READ_GATES 里说明它守什么",
    ).toEqual([]);
  });

  it("地图里没有已经不存在的取函数", () => {
    const live = new Set(declaredGates().map((gate) => gate.key));
    const stale = Object.keys(READ_GATES).filter((entry) => !live.has(entry));

    expect(stale, "READ_GATES 里的条目在 lib/ 下已经找不到").toEqual([]);
  });

  it("每个查能力的 Server Action 都在地图里登记过", () => {
    const missing = declaredActions()
      .filter((action) => action.capability !== null)
      .filter((action) => !(action.name in WRITE_GATES))
      .map((action) => `${action.name}  (${action.file})`);

    expect(
      missing,
      "新增了 requireCapability 的 Server Action，但没有在 WRITE_GATES 里登记",
    ).toEqual([]);
  });

  /**
   * The other direction, and sharper than a stale read entry: a `WRITE_GATES`
   * row for an action that no longer checks anything reads as "this is
   * guarded" about something that is not.
   */
  it("WRITE_GATES 里的动作确实还在查它声称的那个能力", () => {
    const actions = new Map(
      declaredActions().map((action) => [action.name, action]),
    );

    const wrong = Object.entries(WRITE_GATES).flatMap(([name, gate]) => {
      const action = actions.get(name);
      if (!action) return [`${name}：已经找不到这个 Server Action`];
      if (action.capability === null) {
        return [`${name}：源码里已经没有 requireCapability 了`];
      }

      const declared: readonly string[] = gate.capabilities;
      return declared.includes(action.capability)
        ? []
        : [
            `${name}：地图写的是 ${declared.join("、")}，源码查的是 ${action.capability}`,
          ];
    });

    expect(wrong, "WRITE_GATES 与源码不一致").toEqual([]);
  });

  /**
   * The invariant that catches the two mistakes a list of capabilities cannot
   * catch on its own: a capability added and never wired to anything, and a
   * capability whose last asker was refactored away. Both leave a word in the
   * vocabulary that looks like a control and is not — and the second is the
   * worse one, because the entry survives in `CAPABILITY_LABELS` and an
   * operator can still see it listed against a group.
   *
   * `PAGE_CHECKS` deliberately does not count. A capability asked only by the
   * site header decides a nav link and nothing else.
   */
  it("每一项能力都至少被一个门禁认领", () => {
    const claimed = new Set(
      Object.values(ALL_GATES).flatMap((gate) => gate.capabilities),
    );

    const orphans = CAPABILITIES.filter(
      (capability) => !claimed.has(capability),
    );

    expect(
      orphans,
      "这些能力没有任何门禁在问，它们是死词汇：要么忘了接上，要么最后一个使用者已经被改掉了",
    ).toEqual([]);
  });

  it("每个门禁外的能力检查都在 PAGE_CHECKS 里表过态", () => {
    const missing = [
      ...new Set(
        checksOutsideGates()
          .filter((check) => !(check.file in PAGE_CHECKS))
          .map((check) => `${check.file}  (${check.capability})`),
      ),
    ];

    expect(
      missing,
      "在门禁之外问了 viewer.can(…)，需要在 PAGE_CHECKS 里说明它是不是边界",
    ).toEqual([]);
  });

  it("PAGE_CHECKS 里没有已经不问能力的文件", () => {
    const live = new Set(checksOutsideGates().map((check) => check.file));
    const stale = Object.keys(PAGE_CHECKS).filter((file) => !live.has(file));

    expect(stale, "PAGE_CHECKS 里的文件已经不查任何能力了").toEqual([]);
  });

  /**
   * An empty `capabilities` is a real answer — several gates are ones no
   * capability opens, and `submitFor` refusing a `problem.viewAll` holder is
   * the whole reason proofreading a round is not competing in it. It just has
   * to be an answer rather than a blank cell.
   */
  it("没有能力覆盖的门禁都写了为什么", () => {
    for (const [name, gate] of Object.entries(ALL_GATES)) {
      if (gate.capabilities.length > 0) continue;
      expect(
        gate.noOverride,
        `${name} 没有能力覆盖，但也没写 noOverride`,
      ).toBeTruthy();
    }
  });

  /**
   * The column against the declaration it describes. See `DENIED_ADMITS` for
   * which values can be checked this way and why the rest cannot.
   */
  it("denied 声称的形状，函数签名得容得下", () => {
    const signatures = new Map(
      declaredGates().map((gate) => [gate.key, gate.returns]),
    );

    const wrong = Object.entries(READS).flatMap(([name, gate]) => {
      const admits = DENIED_ADMITS[gate.denied];
      const signature = signatures.get(name);
      // A gate the scan no longer finds is the staleness case above, and
      // saying it twice adds nothing.
      if (!admits || signature === undefined) return [];

      return admits.test(signature)
        ? []
        : [`${name}：denied 写的是 ${gate.denied}，但签名是「${signature}」`];
    });

    expect(wrong, "denied 这一列与函数签名对不上").toEqual([]);
  });

  /**
   * The asymmetry `./enforcement` argues for, which until now lived only in
   * its prose: a page that cannot show you something renders without it, so a
   * read gate always has a value to hand back, while an action you may not
   * take has no partial version to fall back to. A read gate that threw would
   * push a branch onto every page that calls it; a write gate that returned
   * something would let a caller ignore the refusal.
   */
  it("动作的拒绝一律是抛出，取函数一律不是", () => {
    const wrong = [
      ...Object.entries(WRITES)
        .filter(([, gate]) => gate.denied !== "throws")
        .map(([name]) => `${name}：动作的 denied 应该是 throws`),
      ...Object.entries(READS)
        .filter(([, gate]) => gate.denied === "throws")
        .map(([name]) => `${name}：取函数不该用抛出表示拒绝`),
    ];

    expect(wrong, "两张表的 denied 应当是对称的两种形状").toEqual([]);
  });

  it("扫描确实找到了东西，而不是路径写错后空过", () => {
    // Without this, a wrong ROOT would make every assertion above pass by
    // finding nothing at all — the failure mode of a filesystem test. Set well
    // under the current counts on purpose: this is here to catch a scan that
    // returns nothing, and a bound sitting at the exact population would also
    // fire whenever something is legitimately retired, which the staleness
    // checks above already report in a way that says what to do about it.
    expect(declaredGates().length).toBeGreaterThanOrEqual(15);
    expect(
      declaredActions().filter((action) => action.capability).length,
    ).toBeGreaterThanOrEqual(2);
    expect(checksOutsideGates().length).toBeGreaterThanOrEqual(4);

    // And the signatures specifically, because `returnType` answering "" for
    // everything would make the `denied` check above pass by asserting
    // nothing — the same failure in a smaller place.
    expect(
      declaredGates().filter((gate) => gate.returns.length > 0).length,
    ).toBeGreaterThanOrEqual(15);
  });
});

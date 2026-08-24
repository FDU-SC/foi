import { contestRulesetModules, rulesetModules } from "@/content";
import type { AnyRuleset } from "./types";

/**
 * Scoring formats, discovered the same way problems and contests are.
 *
 * ACM, OI and CTF are templates rather than built-ins — the kernel knows only
 * the `Ruleset` interface — and they used to need a line in a hand-written
 * array here to exist. Now a file under `content/rulesets/` is enough, which
 * makes adding a format cost exactly what adding a problem costs.
 *
 * A contest may also carry its own beside its `contest.ts`, which
 * `lib/contests/registry.ts` prefers over anything named here. Those are
 * deliberately absent from `listRulesets()`: a format written for one round is
 * not on offer to the others.
 */
function idFromPath(path: string): string | null {
  return path.match(/\/([^/]+)\.tsx$/)?.[1] ?? null;
}

function exportedRuleset(path: string, mod: unknown): AnyRuleset {
  const exported = (mod as { ruleset?: unknown }).ruleset;
  if (exported === undefined) {
    throw new Error(`${path} 必须导出名为 ruleset 的常量`);
  }

  const candidate = exported as Partial<AnyRuleset>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.computeStandings !== "function" ||
    typeof candidate.supportsFreeze !== "boolean"
  ) {
    throw new Error(
      `${path} 导出的 ruleset 不符合 Ruleset 接口，请检查 id、name、supportsFreeze 与 computeStandings。`,
    );
  }

  return candidate as AnyRuleset;
}

function buildRegistry(): Map<string, AnyRuleset> {
  const registry = new Map<string, AnyRuleset>();

  for (const path of Object.keys(rulesetModules).sort()) {
    const fileId = idFromPath(path);
    if (!fileId) continue;

    const ruleset = exportedRuleset(path, rulesetModules[path]);

    // Same rule as a problem's slug and a contest's: the filename is how a
    // reader finds the format a contest names, so the two must agree.
    if (ruleset.id !== fileId) {
      throw new Error(
        `${path} 的赛制 id "${ruleset.id}" 与文件名 "${fileId}" 不一致`,
      );
    }
    if (registry.has(ruleset.id)) {
      throw new Error(`赛制 "${ruleset.id}" 重复声明`);
    }

    registry.set(ruleset.id, ruleset);
  }

  return registry;
}

function buildContestRulesets(): Map<string, AnyRuleset> {
  const own = new Map<string, AnyRuleset>();

  for (const path of Object.keys(contestRulesetModules).sort()) {
    const slug = path.match(/\/contests\/([^/]+)\/ruleset\.tsx$/)?.[1];
    if (!slug) continue;
    own.set(slug, exportedRuleset(path, contestRulesetModules[path]));
  }

  return own;
}

const registry = buildRegistry();
const contestOwned = buildContestRulesets();

export function getRuleset(id: string): AnyRuleset | undefined {
  return registry.get(id);
}

/** The format a contest carries itself, if it has one. */
export function getContestRuleset(slug: string): AnyRuleset | undefined {
  return contestOwned.get(slug);
}

/**
 * The format a contest is scored by: its own if it has one, otherwise the
 * template it names.
 *
 * One definition because two callers ask — the registry, which turns "neither"
 * and "both" into load errors, and `computeStandings`, which by then can
 * assume the contest loaded. If they disagreed, a contest would validate
 * against one format and be scored by another.
 */
export function rulesetFor(
  contestSlug: string,
  namedId: string | undefined,
): AnyRuleset | undefined {
  return (
    getContestRuleset(contestSlug) ?? (namedId ? getRuleset(namedId) : undefined)
  );
}

/** The shared templates, which is what an operator is offered. */
export function listRulesets(): AnyRuleset[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

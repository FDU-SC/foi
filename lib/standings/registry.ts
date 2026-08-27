import { rulesetModules } from "@/content/ruleset-modules";
import type { AnyRuleset } from "./types";

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
    typeof candidate.computeStandings !== "function"
  ) {
    throw new Error(
      `${path} 导出的 ruleset 不符合 Ruleset 接口，请检查 id、name 与 computeStandings。`,
    );
  }

  if (
    candidate.supportsFreeze !== undefined &&
    typeof candidate.supportsFreeze !== "boolean"
  ) {
    throw new Error(`${path} 的 supportsFreeze 必须是布尔值，或者干脆不写。`);
  }

  return candidate as AnyRuleset;
}

function buildRegistry(): Map<string, AnyRuleset> {
  const registry = new Map<string, AnyRuleset>();

  for (const path of Object.keys(rulesetModules).sort()) {
    const fileId = idFromPath(path);
    if (!fileId) continue;

    const ruleset = exportedRuleset(path, rulesetModules[path]);

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

const registry = buildRegistry();

export function rulesetFor(namedId: string): AnyRuleset | undefined {
  return registry.get(namedId);
}

export function listRulesets(): AnyRuleset[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

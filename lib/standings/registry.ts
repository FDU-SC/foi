import { rulesetModules } from "@/content/_modules/rulesets";
import type { AnyRuleset, RulesetRenderers } from "./types";

interface RegistryEntry {
  ruleset: AnyRuleset;
  renderers: RulesetRenderers;
}

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
    typeof candidate.compute !== "function"
  ) {
    throw new Error(
      `${path} 导出的 ruleset 不符合 Ruleset 接口，请检查 id、name 与 compute。`,
    );
  }

  return candidate as AnyRuleset;
}

function extractRenderers(mod: unknown): RulesetRenderers {
  const exported = (mod as { renderers?: RulesetRenderers }).renderers;
  return exported ?? {};
}

function buildRegistry(): Map<string, RegistryEntry> {
  const registry = new Map<string, RegistryEntry>();

  for (const path of Object.keys(rulesetModules).sort()) {
    const fileId = idFromPath(path);
    if (!fileId) continue;

    const mod = rulesetModules[path];
    const ruleset = exportedRuleset(path, mod);
    const renderers = extractRenderers(mod);

    if (ruleset.id !== fileId) {
      throw new Error(
        `${path} 的赛制 id "${ruleset.id}" 与文件名 "${fileId}" 不一致`,
      );
    }
    if (registry.has(ruleset.id)) {
      throw new Error(`赛制 "${ruleset.id}" 重复声明`);
    }

    registry.set(ruleset.id, { ruleset, renderers });
  }

  return registry;
}

const registry = buildRegistry();

export function rulesetFor(namedId: string): AnyRuleset | undefined {
  return registry.get(namedId)?.ruleset;
}

export function renderersFor(namedId: string): RulesetRenderers {
  return registry.get(namedId)?.renderers ?? {};
}

export function listRulesets(): AnyRuleset[] {
  return [...registry.values()]
    .map((entry) => entry.ruleset)
    .sort((a, b) => a.id.localeCompare(b.id));
}

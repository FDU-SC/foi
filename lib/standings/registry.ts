import { acmRuleset } from "./rulesets/acm";
import { ctfDynamicRuleset } from "./rulesets/ctf-dynamic";
import { oiRuleset } from "./rulesets/oi";
import type { AnyRuleset } from "./types";

/**
 * ACM, OI and CTF are templates, not built-ins. A new scoring format is a new
 * module under `rulesets/` plus one entry here.
 */
const ALL: AnyRuleset[] = [acmRuleset, oiRuleset, ctfDynamicRuleset];

const registry = new Map(ALL.map((ruleset) => [ruleset.id, ruleset]));

export function getRuleset(id: string): AnyRuleset | undefined {
  return registry.get(id);
}

export function listRulesets(): AnyRuleset[] {
  return ALL;
}

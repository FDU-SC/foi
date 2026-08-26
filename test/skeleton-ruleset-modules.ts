/**
 * The kernel's own fixture standing in for a deployment's scoring formats. See
 * `./skeleton-problem-modules.ts` for what these eight files are and why they
 * are eight.
 *
 * The second glob matches nothing in the skeleton, which is itself the case
 * worth covering: a deployment whose contests all name a shared template.
 */
export const rulesetModules = import.meta.glob(
  "./content-skeleton/rulesets/*.tsx",
  { eager: true },
);

export const contestRulesetModules = import.meta.glob(
  "./content-skeleton/contests/*/ruleset.tsx",
  { eager: true },
);

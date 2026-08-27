import "server-only";

export const rulesetModules = import.meta.glob("./rulesets/*.tsx", {
  eager: true,
});

export const contestRulesetModules = import.meta.glob(
  "./contests/*/ruleset.tsx",
  { eager: true },
);

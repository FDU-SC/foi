import "server-only";

/** Scoring implementations execute only while producing server-rendered data. */
export const rulesetModules = import.meta.glob("./rulesets/*.tsx", {
  eager: true,
});

export const contestRulesetModules = import.meta.glob(
  "./contests/*/ruleset.tsx",
  { eager: true },
);

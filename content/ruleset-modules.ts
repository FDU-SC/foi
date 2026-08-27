import "server-only";

export const rulesetModules = import.meta.glob("./rulesets/*.tsx", {
  eager: true,
});

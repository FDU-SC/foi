import { tally } from "../rulesets";

/** The registry takes the ruleset id from the filename, so the key carries it. */
export const rulesetModules = {
  "./rulesets/fixture-tally.tsx": { ruleset: tally },
};

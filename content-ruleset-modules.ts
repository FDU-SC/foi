import "server-only";

/**
 * Not content: a boundary declaration. See `./content-problem-modules.ts` for
 * why all eight live at the repository root.
 *
 * Scoring formats, in two flavours: shared templates a contest picks by id,
 * and the one-off a contest brings itself in `ruleset.tsx` beside its
 * `contest.ts`.
 *
 * The distinction is not cosmetic. Standings are recomputed on every read and
 * never snapshotted, so editing a shared template silently changes the board
 * of every past contest that used it; a contest carrying its own format is
 * frozen alongside it in git.
 *
 * Server-only because a ruleset is executed while rendering the board, never
 * in the browser: `computeStandings` sees every submission in the contest,
 * including the ones a freeze is meant to withhold.
 */
export const rulesetModules = import.meta.glob("./content/rulesets/*.tsx", {
  eager: true,
});

export const contestRulesetModules = import.meta.glob(
  "./content/contests/*/ruleset.tsx",
  { eager: true },
);

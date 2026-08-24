import "server-only";

/**
 * Not content. This declares where the server/client boundary runs — see
 * `./problem-modules.ts` for why these four files exist and why they live
 * under `content/`.
 *
 * Scoring formats, in two flavours.
 *
 * The shared ones are templates a contest picks by id. They live here rather
 * than under `lib/` because which formats a deployment offers is content, and
 * because getting one right is hard enough that copying ACM's penalty
 * arithmetic into every round would be a mistake waiting to happen.
 *
 * A contest may also bring its own, in `ruleset.tsx` beside its `contest.ts`.
 * That is for the one-off — three problems scored ACM and two scored OI — and
 * it has a second property worth knowing: standings are recomputed on every
 * read, never snapshotted, so editing a shared template changes the board of
 * every past contest that used it. A contest carrying its own format is frozen
 * alongside it in git.
 *
 * Server-only because a ruleset is executed while rendering the board, never
 * in the browser: `computeStandings` sees every submission in the contest,
 * including the ones a freeze is meant to withhold.
 */
export const rulesetModules = import.meta.glob("./rulesets/*.tsx", {
  eager: true,
});

export const contestRulesetModules = import.meta.glob(
  "./contests/*/ruleset.tsx",
  { eager: true },
);

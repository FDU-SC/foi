import "server-only";

/**
 * Not content. This declares where the server/client boundary runs — see
 * `./content-problem-modules.ts` for why these files exist and why they live
 * at the repository root rather than inside `content/`.
 *
 * Schedules, problem sets and entry rules. See `lib/contests/registry.ts`.
 *
 * A contest staged in the repository before it is announced is the case that
 * makes this matter: `visibleTo: []` withholds the round from every viewer,
 * and a browser chunk carrying its title, its start time and its problem list
 * would announce it anyway.
 */
export const contestModules = import.meta.glob(
  "./content/contests/*/contest.ts",
  { eager: true },
);

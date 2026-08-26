/**
 * The kernel's own fixture standing in for a deployment's contests. See
 * `./skeleton-problem-modules.ts` for what these eight files are and why they
 * are eight.
 */
export const contestModules = import.meta.glob(
  "./content-skeleton/contests/*/contest.ts",
  { eager: true },
);

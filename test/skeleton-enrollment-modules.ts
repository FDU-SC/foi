/**
 * The kernel's own fixture standing in for a deployment's registration policy
 * and group rules. See `./skeleton-problem-modules.ts` for what these eight
 * files are and why they are eight.
 */
export const enrollmentModules = import.meta.glob(
  "./content-skeleton/enrollment/*.ts",
  { eager: true },
);

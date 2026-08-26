/**
 * The kernel's own fixture standing in for a deployment's mail copy. See
 * `./skeleton-problem-modules.ts` for what these eight files are and why they
 * are eight.
 */
export const emailModules = import.meta.glob(
  "./content-skeleton/emails/index.ts",
  { eager: true },
);

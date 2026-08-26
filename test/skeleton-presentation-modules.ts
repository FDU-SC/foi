/**
 * The kernel's own fixture standing in for a deployment's statement vocabulary
 * and verdict table. See `./skeleton-problem-modules.ts` for what these eight
 * files are and why they are eight.
 */
export const presentationModules = import.meta.glob(
  "./content-skeleton/components/index.tsx",
  { eager: true },
);

/**
 * The kernel's own fixture standing in for a deployment's per-problem
 * rendering. See `./skeleton-problem-modules.ts` for what these eight files
 * are and why they are eight.
 *
 * The skeleton fills this slot on exactly one of its three problems, so the
 * JSON fallback in `lib/problems/views.ts` has someone walking it.
 */
export const problemViewModules = import.meta.glob(
  "./content-skeleton/problems/*/views.tsx",
  { eager: true },
);

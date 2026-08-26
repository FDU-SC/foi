/**
 * The kernel's own fixture standing in for a deployment's problem backends.
 * See `./skeleton-problem-modules.ts` for what these eight files are and why
 * they are eight.
 *
 * One backend, `example`, which is what makes the four `FOI_BACKEND_*` lines
 * in the `verify` job visibly a fact about `content/backends.ts` rather than
 * about the platform.
 */
export const backendModules = import.meta.glob(
  "./content-skeleton/backends.ts",
  { eager: true },
);

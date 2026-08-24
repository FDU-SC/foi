import "server-only";

/**
 * Problem source modules are a server-only content boundary.
 *
 * Keeping this glob separate from enrollment, contest, and ruleset registries
 * prevents one dynamic content graph from pulling unrelated private modules
 * into a browser chunk. The `server-only` marker keeps lazy statement chunks
 * in the server graph while preserving per-problem loading.
 */
export const problemConfigModules = import.meta.glob(
  "./problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./problems/*/statement.mdx",
);

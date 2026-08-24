import "server-only";

/**
 * Problem source modules are a server-only content boundary.
 *
 * Keeping this glob separate from enrollment, contest, and ruleset registries
 * prevents one dynamic content graph from pulling unrelated private modules
 * into a browser chunk. Statements are eager on purpose: lazy glob chunks are
 * public static assets, while an eager Server Component stays in the server
 * module graph and is rendered only after the access gate has passed.
 */
export const problemConfigModules = import.meta.glob(
  "./problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./problems/*/statement.mdx",
  { eager: true },
);

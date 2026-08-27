import "server-only";

export const problemConfigModules = import.meta.glob(
  "../problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "../problems/*/statement.mdx",
);

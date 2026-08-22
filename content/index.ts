/**
 * Turbopack's `import.meta.glob` only scans downward from the calling file —
 * patterns using `../`, the `@/` alias, or a leading `/` all resolve to
 * nothing. So the glob lives here, next to what it scans, and
 * `lib/problems/registry.ts` consumes the result.
 */
export const problemConfigModules = import.meta.glob(
  "./problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./problems/*/statement.mdx",
);

/**
 * Turbopack's `import.meta.glob` only scans downward from the calling file —
 * patterns using `../`, the `@/` alias, or a leading `/` all resolve to
 * nothing. So the globs live here, next to what they scan, and the registries
 * under `lib/` consume the results.
 *
 * Configs load eagerly because listing pages need all of them at once;
 * statements load lazily so a problem page pulls in only the MDX it is about
 * to render.
 */
export const problemConfigModules = import.meta.glob(
  "./problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./problems/*/statement.mdx",
);

/** Accounts, roles and cohort tags. Consumed by `lib/roster/registry.ts`. */
export const rosterModules = import.meta.glob("./roster/*.ts", { eager: true });

/** Schedules, problem sets and entry rules. See `lib/contests/registry.ts`. */
export const contestModules = import.meta.glob("./contests/*/contest.ts", {
  eager: true,
});

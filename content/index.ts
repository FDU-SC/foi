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

/**
 * Who may register, which cohort an address belongs to, and who holds a role.
 * Not who exists — that is the `accounts` table. See
 * `lib/enrollment/registry.ts`.
 */
export const enrollmentModules = import.meta.glob("./enrollment/*.ts", {
  eager: true,
});

/** Schedules, problem sets and entry rules. See `lib/contests/registry.ts`. */
export const contestModules = import.meta.glob("./contests/*/contest.ts", {
  eager: true,
});

/**
 * Scoring formats, in two flavours.
 *
 * The shared ones are templates a contest picks by id. They live here rather
 * than under `lib/` because which formats a deployment offers is content, and
 * because getting one right is hard enough that copying ACM's penalty
 * arithmetic into every round would be a mistake waiting to happen.
 *
 * A contest may also bring its own, in `ruleset.tsx` beside its `contest.ts`.
 * That is for the one-off — three problems scored ACM and two scored OI — and
 * it has a second property worth knowing: standings are recomputed on every
 * read, never snapshotted, so editing a shared template changes the board of
 * every past contest that used it. A contest carrying its own format is frozen
 * alongside it in git.
 */
export const rulesetModules = import.meta.glob("./rulesets/*.tsx", {
  eager: true,
});

export const contestRulesetModules = import.meta.glob(
  "./contests/*/ruleset.tsx",
  { eager: true },
);

/**
 * The kernel's own fixture standing in for a deployment's problems.
 *
 * One of eight files mirroring the `content-*-modules.ts` globs at the
 * repository root, pointed at `./content-skeleton/` instead of `../content/`.
 * `vitest.config.mts` aliases `@/content-<name>-modules` to
 * `./skeleton-<name>-modules.ts` when `FOI_TEST_CONTENT=skeleton`, which is
 * what lets the kernel's suites run with no deployment content mounted — see
 * the `content-absent` job in `.github/workflows/check.yml`.
 *
 * Eight files rather than one that exports all the globs, and the reason is
 * not symmetry. Collapsing them puts every content module in a single graph,
 * and the content graph reaches back into `lib/`: a skeleton `views.tsx`
 * imports `components/opaque/verdict-body`, which imports `lib/problems/views`,
 * which imports the glob it came from. Split, that is eight small cycles the
 * loader resolves; merged, it is one cycle that hands `lib/problems/views` an
 * `undefined` registry at module scope.
 *
 * No `server-only` on any of them: the marker is stubbed in the same config,
 * and the boundary these files describe is a browser one that vitest does not
 * have.
 *
 * The globs scan downward from `test/`, which is why these sit here rather
 * than inside `content-skeleton/`. Putting them in there would give the
 * fixture its own copy of the boundary — the arrangement the root move ended.
 */
export const problemConfigModules = import.meta.glob(
  "./content-skeleton/problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./content-skeleton/problems/*/statement.mdx",
);

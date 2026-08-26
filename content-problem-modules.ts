import "server-only";

/**
 * Not content: a boundary declaration. The other seven
 * `content-*-modules.ts` point here rather than restate why all eight sit at
 * the repository root. Two reasons, each sufficient on its own.
 *
 * `import.meta.glob` only scans downward from the calling file, and it fails
 * *silently*: `../`, the `@/` alias and a leading `/` each yield `{}` with no
 * error and no warning, at build time or at run time. Verified against Next
 * 16.3.1 by build probe: the root-relative pattern below returns all 11
 * problem modules, the same pattern behind any of those three prefixes returns
 * nothing, and every registry downstream reads that as a deployment that ships
 * no problems. Relocating one of these files, or tidying a pattern into an
 * alias, is therefore not a refactor that fails loudly.
 *
 * Second, a glob must outlive the directory it scans: `rm -rf content` has to
 * leave a kernel that still compiles, boots and serves, which the
 * `content-absent` job in `.github/workflows/check.yml` enforces. A glob over
 * a missing directory yields `{}`, and every registry under `lib/` treats an
 * empty result as a legal deployment. The root is the nearest position that
 * satisfies both constraints.
 *
 * `server-only` is what makes the boundary hold. A problem's `backend.config`
 * routinely holds testdata locations, checker settings, or literal answers,
 * and `toPublicConfig` strips it from the *data* handed to a client component
 * — which says nothing about the *module*. A single glob over all of
 * `content/` lets any client component that reaches for any one thing pull
 * every problem, every statement and every enrolment rule into a browser
 * chunk; eight globs bound the blast radius, and the marker above turns that
 * mistake into a failed build rather than a shipped answer key.
 *
 * Configs load eagerly since listing pages need all of them at once;
 * statements load lazily so a problem page pulls in only the MDX it is about
 * to render.
 */
export const problemConfigModules = import.meta.glob(
  "./content/problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./content/problems/*/statement.mdx",
);

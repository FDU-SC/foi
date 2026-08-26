/**
 * Not content: a boundary declaration. See `./content-problem-modules.ts` for
 * why all eight live at the repository root.
 *
 * How each problem draws the two things the kernel refuses to interpret: what
 * somebody submitted, and what came back inside `verdict.detail`. See
 * `lib/problems/views.ts`.
 *
 * Deliberately **without** `import "server-only"`, which is the whole reason
 * this is its own file rather than part of `./content-problem-modules.ts`:
 * that glob carries answers and testdata paths, this one carries components,
 * and components render in the browser. A `views.tsx` is public by
 * construction, so nothing in one may reach for `problem.ts`.
 *
 * That rule is also why "which problems take the shared rendering" cannot be
 * derived from anything on a problem: `ui.submit` and `backend.kind` both live
 * behind the server-only glob, and reading either one here would pull the
 * whole of it into a browser chunk. A deployment states the mapping instead,
 * in the second glob below.
 */
export const problemViewModules = import.meta.glob(
  "./content/problems/*/views.tsx",
  { eager: true },
);

/**
 * The deployment's defaults, which the per-problem files above override.
 *
 * One optional module rather than a glob over many, because it is a single
 * table: `problems/views.ts` beside the problem directories, exporting
 * `problemViews`. Absent — as in a tree with no `content/` — every problem
 * falls back to whatever its own `views.tsx` says, and a problem with neither
 * renders as JSON.
 */
export const problemViewDefaultModules = import.meta.glob(
  "./content/problems/views.ts",
  { eager: true },
);

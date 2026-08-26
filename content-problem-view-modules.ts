/**
 * Not content. This declares where the server/client boundary runs — see
 * `./content-problem-modules.ts` for why these files exist and why they live
 * at the repository root rather than inside `content/`.
 *
 * How each problem draws the two things the kernel refuses to interpret: what
 * somebody submitted, and what came back inside `verdict.detail`. See
 * `lib/problems/views.ts`.
 *
 * Separate from `./content-problem-modules.ts` and deliberately **without**
 * `import "server-only"`, which is the whole reason it is its own file. That
 * glob carries answers and testdata paths and must never reach a browser; this
 * one is components, and components render there. A `views.tsx` is therefore
 * public by construction — it is being handed to the client — so nothing in
 * one may reach for `problem.ts`.
 */
export const problemViewModules = import.meta.glob(
  "./content/problems/*/views.tsx",
  { eager: true },
);

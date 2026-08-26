/**
 * Not content: a boundary declaration. See `./content-problem-modules.ts` for
 * why all eight live at the repository root.
 *
 * One of the two globs **without** `import "server-only"`, and that exception
 * is the whole reason it is a separate file. Statement components render in
 * the browser, so this graph must be reachable from a client chunk while the
 * six server-only globs beside it must not be. Anything a deployment puts
 * behind this export is public by construction.
 *
 * See `lib/presentation.ts`.
 */
export const presentationModules = import.meta.glob(
  "./content/components/index.tsx",
  { eager: true },
);

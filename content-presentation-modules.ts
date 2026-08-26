/**
 * Not content. This declares where the server/client boundary runs — see
 * `./content-problem-modules.ts` for why these files exist and why they live
 * at the repository root rather than inside `content/`.
 *
 * One of the two globs **without** `import "server-only"`, and the exception
 * is the whole reason it is a separate file. Statement components render in
 * the browser, so this graph has to be reachable from a client chunk; the six
 * server-only globs beside it must not be. Anything a deployment puts behind
 * this export is public by construction — it is being handed to a browser —
 * which is the opposite of the rule on those six and worth stating twice.
 *
 * See `lib/presentation/registry.ts`.
 */
export const presentationModules = import.meta.glob(
  "./content/components/index.tsx",
  { eager: true },
);

/**
 * Not content. This declares where the server/client boundary runs — see
 * `./problem-modules.ts` for why these `*-modules.ts` files exist and why they
 * live under `content/`.
 *
 * The one glob **without** `import "server-only"`, and the exception is the
 * whole reason it is a separate file. Statement components render in the
 * browser, so this graph has to be reachable from a client chunk; every other
 * glob here must not be. Anything a deployment puts behind this export is
 * public by construction — it is being handed to a browser — which is the
 * opposite of the rule on the other five and worth stating twice.
 *
 * See `lib/presentation/registry.ts`.
 */
export const presentationModules = import.meta.glob("./components/index.tsx", {
  eager: true,
});

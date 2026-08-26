import "server-only";

/**
 * Not content. This declares where the server/client boundary runs — see
 * `./content-problem-modules.ts` for why these files exist and why they live
 * at the repository root rather than inside `content/`.
 *
 * Which problem backends this deployment runs. See `lib/backend/registry.ts`.
 *
 * This one used to be `backends.config.ts` at the repository root, imported by
 * name from `lib/backend/`. That made it the only extension point the kernel
 * had to be edited alongside — four service names, one of them a problem's
 * slug, sitting in the platform's own import graph. Nothing about the contents
 * changed in moving it; what changed is that the kernel now discovers the list
 * instead of containing it.
 *
 * `server-only` because the entries hold signing keys. A key reaching a
 * browser chunk is the whole queue: see `verifyRunner`.
 */
export const backendModules = import.meta.glob("./content/backends.ts", {
  eager: true,
});

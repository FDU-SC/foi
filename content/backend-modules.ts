import "server-only";

/**
 * Not content: a boundary declaration. See `./content-problem-modules.ts` for
 * why all eight live at the repository root.
 *
 * Which problem backends this deployment runs. See `lib/backend/registry.ts`.
 *
 * `server-only` because the entries hold signing keys. A key reaching a
 * browser chunk is the whole queue: see `verifyRunner`.
 */
export const backendModules = import.meta.glob("./content/backends.ts", {
  eager: true,
});

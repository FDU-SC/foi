import "server-only";

/**
 * Not content: a boundary declaration. See `./content-problem-modules.ts` for
 * why all eight live at the repository root.
 *
 * The copy of every message the kernel sends. See `lib/mail/registry.ts`.
 *
 * A single file rather than a directory glob, because the contract is two
 * named methods rather than a list that accumulates: see `EmailTemplates`.
 * Splitting the copy across several files is still fine, they just have to
 * meet at this export.
 */
export const emailModules = import.meta.glob("./content/emails/index.ts", {
  eager: true,
});

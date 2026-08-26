import "server-only";

/**
 * Not content: a boundary declaration. See `./problem-modules.ts` for why
 * all eight live at the top of `content/`.
 *
 * The copy of every message the kernel sends. See `lib/mail/registry.ts`.
 *
 * A single file rather than a directory glob, because the contract is two
 * named methods rather than a list that accumulates: see `EmailTemplates`.
 * Splitting the copy across several files is still fine, they just have to
 * meet at this export.
 */
export const emailModules = import.meta.glob("./emails/index.ts", {
  eager: true,
});

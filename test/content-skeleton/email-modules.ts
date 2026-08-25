import "server-only";

/**
 * Not content. This declares where the server/client boundary runs — see
 * `./problem-modules.ts` for why these `*-modules.ts` files exist and why they
 * live under `content/`.
 *
 * The copy of every message the kernel sends. See `lib/mail/registry.ts`.
 *
 * The last of the extension points to get a glob, and the one that made the
 * boundary a claim rather than a fact: `lib/mail/notify.ts` used to import
 * `@/content/emails` by name, so a deployment that shipped no copy did not
 * fall back — it failed to compile. Discovery makes the templates optional in
 * the only sense that matters, which is that the kernel builds without them.
 *
 * A single file rather than a directory glob, because the contract is two
 * named methods rather than a list that accumulates: see `EmailTemplates`.
 * Splitting the copy across several files is still fine, they just have to
 * meet at this export.
 */
export const emailModules = import.meta.glob("./emails/index.ts", {
  eager: true,
});

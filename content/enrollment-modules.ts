import "server-only";

/**
 * Not content. This declares where the server/client boundary runs — see
 * `./problem-modules.ts` for why these four files exist and why they live
 * under `content/`.
 *
 * Who may register, which cohort an address belongs to, and who holds a
 * capability. Not who exists — that is the `accounts` table. See
 * `lib/enrollment/registry.ts`.
 *
 * The sharpest of the four to keep off the client. A rule file carries the
 * address patterns for an entire intake and the handles of everybody holding
 * privilege, and none of it is redacted on the way out because nothing was
 * ever supposed to send it. `lib/auth/groups.ts` reads this, and a client
 * component reaching for `groupName` is how the whole set shipped once
 * already.
 */
export const enrollmentModules = import.meta.glob("./enrollment/*.ts", {
  eager: true,
});

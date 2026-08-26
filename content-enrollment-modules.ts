import "server-only";

/**
 * Not content: a boundary declaration. See `./content-problem-modules.ts` for
 * why all eight live at the repository root.
 *
 * Who may register, which cohort an address belongs to, and who holds a
 * capability. Not who exists — that is the `accounts` table. See
 * `lib/enrollment/registry.ts`.
 *
 * The sharpest of the eight to keep off the client. A rule file carries the
 * address patterns for an entire intake and the handles of everybody holding
 * privilege, and none of it is redacted on the way out because nothing is ever
 * supposed to send it. `lib/auth/groups.ts` reads this, so a client component
 * reaching for something as innocuous as `groupName` ships the whole set.
 */
export const enrollmentModules = import.meta.glob("./content/enrollment/*.ts", {
  eager: true,
});

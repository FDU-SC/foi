import { can, type Capability, type RoleId } from "./policy";

/**
 * The identity the kernel carries around.
 *
 * `handle` is the primary key everywhere — in the roster that defines this
 * person, in the credentials row that lets them log in, and on their
 * submissions. There is no separate opaque id, for the same reason a problem
 * is keyed by its slug: one name, derivable from the URL and from the source
 * file, with no lookup table in between.
 */
export interface SessionUser {
  handle: string;
  displayName: string;
  role: RoleId;
}

export type { Capability, RoleId };

/** Convenience wrapper so call sites can pass a session user directly. */
export function userCan(
  user: SessionUser | null | undefined,
  capability: Capability,
): boolean {
  return can(user, capability);
}

import type { Capability } from "./policy";

/**
 * The identity the kernel carries around.
 *
 * `handle` is the primary key everywhere — in the account row, in the
 * credentials row that lets them log in, and on their submissions. There is no
 * separate opaque id, for the same reason a problem is keyed by its slug: one
 * name, derivable from the URL and from the source file, with no lookup table
 * in between.
 *
 * `groups` is every group this person is in, privileged or not. It replaced a
 * single `role` plus a separate `tags` list: those were two ways to sort the
 * same people, one of which could carry permissions and could not classify,
 * the other of which could classify and could not carry permissions.
 *
 * This describes who somebody is, not what they may do. That question has one
 * spelling — `viewer.can(capability)` — and lives in `./viewer`. There used to
 * be a `userCan` here as well, which was a third way to ask it.
 */
export interface SessionUser {
  handle: string;
  displayName: string;
  groups: string[];
}

export type { Capability };

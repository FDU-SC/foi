import { capabilitiesOf } from "./groups";
import type { Capability } from "./policy";

/**
 * The identity the kernel carries around.
 *
 * `handle` is the primary key everywhere — in the account row that lets them
 * log in, and on their submissions. There is no separate opaque id, for the
 * same reason a problem is keyed by its slug: one
 * name, derivable from the URL and from the source file, with no lookup table
 * in between.
 *
 * `groups` is every group this person is in, privileged or not.
 *
 * This describes who somebody is, not what they may do. That question has one
 * spelling — `viewer.can(capability)` — and is the `Viewer` below.
 */
export interface SessionUser {
  handle: string;
  displayName: string;
  groups: string[];
}

/**
 * Who is asking, and the one way to ask what they may do.
 *
 * A viewer deliberately carries no named booleans — `preview`,
 * `inspectJudges`, `readAnySubmission` — because that copies the capability
 * list into a second shape: adding one then means editing the policy, this
 * interface and the function below, and forgetting the third step produces a
 * viewer that silently answers `undefined`.
 *
 * So a viewer carries identity and defers everything else. The capability list
 * has one definition in `./policy`, the mapping from group to capability has
 * one definition in `content/enrollment/`, and every question about either is
 * spelled `viewer.can("...")`.
 */
export interface Viewer {
  /**
   * Who this is, or null when nobody is signed in.
   *
   * Here because some resources are scoped by identity rather than by group: a
   * submission is yours or it is not, and no capability changes that for the
   * person who made it.
   */
  readonly handle: string | null;

  /** Every group this person belongs to, privileged or not. */
  readonly groups: readonly string[];

  /** The only question anything asks about permission. */
  can(capability: Capability): boolean;
}

/**
 * The viewer a request should use, and the only place one is made.
 *
 * Takes the user rather than a capability so that no call site has to remember
 * which capability governs which resource.
 *
 * The sole producer. A groupless `AS_PLAYER` viewer is a test fixture and
 * lives in `test/auth-support.ts`; the gates it would be aimed at say in their
 * own comments why they must not use one.
 */
export function viewerFor(
  user: { handle: string; groups: readonly string[] } | null | undefined,
): Viewer {
  const groups = user?.groups ?? [];
  // Resolved once per viewer rather than per question: a request asks several
  // times, and the answer cannot change within one.
  const granted = capabilitiesOf(groups);
  return {
    handle: user?.handle ?? null,
    groups,
    can: (capability) => granted.has(capability),
  };
}

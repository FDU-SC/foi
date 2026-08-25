import { capabilitiesOf } from "./groups";
import type { Capability } from "./policy";

/**
 * Who is asking, and the one way to ask what they may do.
 *
 * There were three mechanisms for a while: `can(user, cap)` at some call
 * sites, `userCan(user, cap)` at others, and a `Viewer` that carried the
 * answers as named booleans — `preview`, `inspectJudges`, `readAnySubmission`.
 * That last one was the worst of the three, because it copied the capability
 * list into a second shape: adding a capability meant editing the policy, then
 * this interface, then the function below, and forgetting the third step
 * produced a viewer that silently answered `undefined`.
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
 * There was a `makeViewer` under this for a while, because there was a second
 * producer above it — an `AS_PLAYER` constant for callers that wanted to ask
 * with no groups. Nothing outside a test ever wanted that, and the two gates
 * it was written for say in their own comments why they do not; it now lives
 * in `./test-support`, which left this function as the sole producer and the
 * helper as an indirection with one caller.
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

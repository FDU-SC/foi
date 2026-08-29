import type { DenialReason } from "./actions";
import type { Decision } from "./types";

/**
 * How a refusal reaches the caller.
 *
 * The engine only ever produces a `Decision`; these turn it into the shape each
 * layer expects, so "denied" looks the same everywhere it surfaces.
 */

export type Denial = Extract<Decision, { allow: false }>;
export type Allowance = Extract<Decision, { allow: true }>;

/**
 * A refusal no policy was asked about — the resource does not exist, or the
 * caller named one that cannot apply. Shaped like any other denial so callers
 * handle it through the same adapters.
 */
export function denied(reason: DenialReason): Denial {
  return { allow: false, via: null, reason };
}

/**
 * For handlers that need an identity before they can ask anything — the same
 * refusal `builtin:anonymous-cannot-write` produces, so the two never diverge.
 */
export const UNAUTHENTICATED: Denial = denied({
  code: "unauthenticated",
  message: "请先登录",
});

export class ForbiddenError extends Error {
  readonly reason: DenialReason;

  /** The policy that refused, or null when nothing permitted the request. */
  readonly via: string | null;

  constructor(denial: Denial) {
    super(denial.reason.message);
    this.name = "ForbiddenError";
    this.reason = denial.reason;
    this.via = denial.via;
  }
}

/**
 * For writes: refusal is an exception, so an action cannot fall through to its
 * effect by forgetting to check a return value. Reads do the opposite — they
 * return `undefined`, leaving a denied resource indistinguishable from one that
 * never existed.
 */
export function assertAllowed(
  decision: Decision,
): asserts decision is Allowance {
  if (!decision.allow) throw new ForbiddenError(decision);
}

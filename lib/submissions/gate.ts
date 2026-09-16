import type { Denial } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { contestEntryFor } from "@/lib/contests/access";
import { submitRateLimit, type ActionRateLimit } from "@/lib/problems/types";

export type SubmitGate =
  | {
      ok: true;
      ref: ContestProblemRef;

      rateLimit: ActionRateLimit;
    }
  | { ok: false; denial: Denial };

/**
 * Whether this submission may be queued.
 *
 * Two questions, asked in order and never merged: may this person compete in
 * the contest carrying this problem, and may they submit to the problem as part
 * of it. Keeping them apart is what stops "can read the contest" from drifting
 * into "can compete in it".
 */
export function submitFor(
  contestSlug: string,
  problemSlug: string,
  viewer: Viewer,
  now = new Date(),
): SubmitGate {
  const round = contestEntryFor(contestSlug, problemSlug, viewer, now);
  if (!round.ok) return { ok: false, denial: round.denial };

  const { ref } = round;

  const decision = authorize("problem.submit", ref, viewer, { now });
  if (!decision.allow) return { ok: false, denial: decision };

  return {
    ok: true,
    ref,
    rateLimit: submitRateLimit(ref.problem, ref.entry.rateLimit),
  };
}

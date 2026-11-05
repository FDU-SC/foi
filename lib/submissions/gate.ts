import type { Denial } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { contestEntryFor } from "@/lib/contests/access";
import { contestProblemRef } from "@/lib/contests/refs";
import { submitRateLimit, type ActionRateLimit } from "@/lib/problems/types";

export type SubmitGate =
  | {
      ok: true;
      ref: ContestProblemRef;

      /** Not competing: judged as usual, outside every leaderboard. */
      trial: boolean;

      rateLimit: ActionRateLimit;
    }
  | { ok: false; denial: Denial };

function admitted(ref: ContestProblemRef, trial: boolean): SubmitGate {
  return {
    ok: true,
    ref,
    trial,
    rateLimit: submitRateLimit(ref.problem, ref.entry.rateLimit),
  };
}

/**
 * Whether this submission may be queued, and whether it competes.
 *
 * Two questions, asked in order and never merged: may this person compete in
 * the contest carrying this problem, and may they submit to the problem as part
 * of it. Keeping them apart is what stops "can read the contest" from drifting
 * into "can compete in it".
 *
 * Only when competing is refused does `problem.trial` get asked. A refused
 * trial reports why competing was refused, so a viewer without `problem.trial`
 * only ever sees the competing refusal.
 */
export function submitFor(
  contestSlug: string,
  problemSlug: string,
  viewer: Viewer,
  now = new Date(),
): SubmitGate {
  const round = contestEntryFor(contestSlug, problemSlug, viewer, now);
  let refusal: Denial;
  if (round.ok) {
    const decision = authorize("problem.submit", round.ref, viewer, { now });
    if (decision.allow) return admitted(round.ref, false);
    refusal = decision;
  } else {
    refusal = round.denial;
  }

  const ref = round.ok ? round.ref : contestProblemRef(contestSlug, problemSlug);
  if (ref && authorize("problem.trial", ref, viewer, { now }).allow) {
    return admitted(ref, true);
  }
  return { ok: false, denial: refusal };
}

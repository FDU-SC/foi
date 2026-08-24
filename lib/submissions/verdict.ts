import type { Verdict } from "@/lib/backend/types";
import { problemBySlug } from "@/lib/problems/registry";

/**
 * The one place a verdict is read.
 *
 * A backend's reply is a message from an extension point, shaped however the
 * problem's author decided — see `verdictSchema` in `lib/backend/types.ts`,
 * where everything but the status label is optional. What the kernel needs out
 * of it is four values, and it takes them here, on arrival. Everything
 * downstream reads the columns.
 *
 * Both landing paths go through this: the callback in
 * `app/api/judge/callback/route.ts` and the reconciler's poll for a callback
 * that never arrived. They used to hold two copies of the same destructuring,
 * which is the shape the next divergence would have taken.
 */
export interface VerdictColumns {
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
  outcome: string;
}

export function verdictColumns(
  verdict: Verdict,
  problemSlug: string,
): VerdictColumns {
  return {
    score: verdict.score ?? null,

    // The configured total is the fallback, resolved now rather than at read
    // time: editing a problem's `maxScore` should not silently rescore every
    // submission ever made against the old one.
    maxScore: verdict.maxScore ?? problemBySlug(problemSlug)?.maxScore ?? null,

    // Null when the backend did not say, which is not the same as false.
    // `isAccepted` in `lib/standings/types.ts` derives an answer from the
    // score in that case, and keeping the derivation out of the column is what
    // lets it be improved later without a backfill.
    accepted: verdict.accepted ?? null,

    outcome: verdict.status,
  };
}

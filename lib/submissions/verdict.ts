import type { Verdict } from "@/lib/backend/types";

/**
 * The one place a verdict is read.
 *
 * A backend's reply is a message from an extension point, shaped however the
 * problem's author decided — see `verdictSchema` in `lib/backend/types.ts`,
 * where everything but the status label is optional. What the kernel needs out
 * of it is four values, and it takes them here, on arrival. Everything
 * downstream reads the columns.
 *
 * Both landing paths go through this: a runner reporting `done` through
 * `lib/runner/queue.ts`, and an inline problem settling inside the submit
 * request. Two copies of the destructuring is the shape the next divergence
 * would take.
 */
export interface VerdictColumns {
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
  outcome: string;
}

export function verdictColumns(
  verdict: Verdict,
  fallbackMaxScore: number | null,
): VerdictColumns {
  return {
    score: verdict.score ?? null,

    // Resolved on the way in rather than at read time, so editing a problem's
    // configured total cannot silently rescore every submission ever made
    // against the old one.
    //
    // The fallback arrives as a number, not a slug to look up here: looking it
    // up would make the current registry authoritative on every path,
    // including the one that has decided otherwise. `rejudgeSubmissions`
    // clears an entire judging but keeps `max_score`, for precisely the reason
    // above, and a registry lookup here would overwrite it on the next verdict
    // anyway. A denominator is a decision about one submission's history, and
    // the two landing paths do not make it the same way.
    maxScore: verdict.maxScore ?? fallbackMaxScore,

    // Null when the backend did not say, which is not the same as false.
    // `isAccepted` in `lib/standings/types.ts` derives an answer from the
    // score in that case, and keeping the derivation out of the column is what
    // lets it be improved later without a backfill.
    accepted: verdict.accepted ?? null,

    outcome: verdict.status,
  };
}

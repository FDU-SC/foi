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
 * request. They used to hold two copies of the same destructuring, which is the
 * shape the next divergence would have taken.
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
    // The fallback arrives as a number because the caller is the only thing
    // that knows which number it is. This parameter used to be a slug and the
    // lookup happened here, which quietly made the current registry
    // authoritative on every path — including the one path that had decided
    // otherwise. `rejudgeSubmissions` clears an entire judging but keeps
    // `max_score`, for precisely the reason above, and then the next verdict
    // overwrote it from the registry anyway; the exemption bought nothing. A
    // denominator is a decision about one submission's history, and the two
    // landing paths do not make it the same way, so neither of them should have
    // to discover that by reading this function.
    maxScore: verdict.maxScore ?? fallbackMaxScore,

    // Null when the backend did not say, which is not the same as false.
    // `isAccepted` in `lib/standings/types.ts` derives an answer from the
    // score in that case, and keeping the derivation out of the column is what
    // lets it be improved later without a backfill.
    accepted: verdict.accepted ?? null,

    outcome: verdict.status,
  };
}

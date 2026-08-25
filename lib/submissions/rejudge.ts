import { and, eq, inArray, ne } from "drizzle-orm";
import {
  INLINE_BACKEND_ID,
  TERMINAL_STATES,
  type SubmissionState,
} from "@/lib/backend/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { invalidateStandings } from "@/lib/standings/cache";
import { isAccepted } from "@/lib/standings/types";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";

/**
 * The one transition an administrator may make by hand: a finished row back
 * into the queue.
 *
 * One, and no history table behind it. DOMjudge keeps the old judging around
 * marked invalid, and both of its open rejudge bugs come from exactly that —
 * one submission ending up with two judgings both looking valid, which
 * miscounts the scoreboard ([#2883]) and leaves a rejudge unapplied ([#2163]).
 * A row here has one verdict, the current one, and the previous one is gone.
 * When there is a real reason to archive old verdicts, that is a table to add
 * deliberately rather than a side effect to inherit.
 *
 * [#2883]: https://github.com/DOMjudge/domjudge/issues/2883
 * [#2163]: https://github.com/DOMjudge/domjudge/issues/2163
 */

export interface RejudgeResult {
  /** Rows put back in the queue. */
  requeued: number;
  /** Passing submissions left alone because `includeAccepted` was not set. */
  keptAccepted: number;
  /** Inline-judged rows, which no runner can pick up. See below. */
  skippedInline: number;
}

/**
 * Puts finished submissions back in the queue.
 *
 * `includeAccepted` defaults to off, which is DOMjudge's default and worth
 * copying: the expensive mistake is rejudging a whole contest with a fixed
 * checker and turning somebody's accepted submission into a wrong answer,
 * during the round, with no record of what it used to say. Overwriting a pass
 * has to be something an operator asked for in as many words.
 *
 * Everything the last judging left is cleared, not just the state. A row
 * carrying an old `outcome` would sit in the queue rendering a stale AC badge,
 * and a stale badge on a row that is being re-evaluated is worse than no badge:
 * `maxScore` is the one column kept, because it is the denominator the *next*
 * verdict falls back to and re-resolving it here would quietly rescore against
 * a `maxScore` the problem has since been edited to.
 *
 * Inline rows are refused rather than requeued. Nothing signs as `inline`, so
 * no runner will ever claim one — putting it in the queue would leave it
 * spinning until the fuse burned through, six hours later, for an operator who
 * thought they had done something. Rejudging one means submitting again.
 */
export async function rejudgeSubmissions(
  ids: string[],
  options: { includeAccepted?: boolean } = {},
): Promise<RejudgeResult> {
  const empty: RejudgeResult = {
    requeued: 0,
    keptAccepted: 0,
    skippedInline: 0,
  };
  if (ids.length === 0) return empty;

  const rows = await db
    .select()
    .from(submissions)
    .where(
      and(
        inArray(submissions.id, ids),
        inArray(submissions.state, TERMINAL_STATES),
      ),
    );

  const inline = rows.filter((row) => row.backendId === INLINE_BACKEND_ID);
  const external = rows.filter((row) => row.backendId !== INLINE_BACKEND_ID);

  // Asked through the same predicate the standings use, so "already solved"
  // means here what it means on the board — including the case where a backend
  // reported no `accepted` flag and full marks is what settles it.
  const accepted = options.includeAccepted
    ? []
    : external.filter((row) => isAccepted(row));
  const acceptedIds = new Set(accepted.map((row) => row.id));
  const targets = external.filter((row) => !acceptedIds.has(row.id));

  if (targets.length === 0) {
    return {
      requeued: 0,
      keptAccepted: accepted.length,
      skippedInline: inline.length,
    };
  }

  const requeued = await db
    .update(submissions)
    .set({
      state: "queued" satisfies SubmissionState,
      // The lease dies here, and that is what makes this safe to do to a row
      // that something might still be holding: a runner still working on the
      // previous attempt cannot write its result over the new one, because the
      // guard on every report is the lease it no longer matches.
      lease: null,
      runnerId: null,
      runnerStatus: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      // A fresh budget. An administrator asking for this to be tried again is
      // asking for three more goes, not for the remainder of the last three.
      attempts: 0,
      // And a fresh wait. `created_at` deliberately stays where it is — it is
      // when the competitor submitted, and moving it would relocate the row
      // inside the round — so the queue fuse needs its own clock, or every
      // submission older than the fuse would be written off seconds after being
      // requeued, blaming a runner that never got the chance to come.
      queuedAt: new Date(),
      verdict: null,
      score: null,
      accepted: null,
      outcome: null,
      backendVersion: null,
      error: null,
      judgedAt: null,
    })
    .where(
      and(
        inArray(
          submissions.id,
          targets.map((row) => row.id),
        ),
        inArray(submissions.state, TERMINAL_STATES),
        ne(submissions.backendId, INLINE_BACKEND_ID),
      ),
    )
    .returning();

  const contests = new Set<string>();
  for (const row of requeued) {
    publish(toView(row));
    if (row.contestSlug) contests.add(row.contestSlug);
  }
  // A row leaving `completed` changes every board it was counted on, the same
  // way one arriving there does.
  for (const slug of contests) invalidateStandings(slug);

  return {
    requeued: requeued.length,
    keptAccepted: accepted.length,
    skippedInline: inline.length,
  };
}

/** Whether this row is in a state a rejudge can pick up. */
export function isRejudgeable(row: {
  state: SubmissionState;
  backendId: string;
}): boolean {
  return (
    TERMINAL_STATES.includes(row.state) && row.backendId !== INLINE_BACKEND_ID
  );
}

/** One submission's current state, for an action that has only an id. */
export async function submissionStateOf(
  id: string,
): Promise<{ state: SubmissionState; backendId: string } | undefined> {
  const [row] = await db
    .select({ state: submissions.state, backendId: submissions.backendId })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row;
}

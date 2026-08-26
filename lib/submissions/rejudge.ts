import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  INLINE_BACKEND_ID,
  TERMINAL_STATES,
  type SubmissionState,
} from "@/lib/backend/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { problemBySlug } from "@/lib/problems/registry";
import { isInlineBackend } from "@/lib/problems/types";
import { invalidateStandings } from "@/lib/standings/cache";
import { isAccepted } from "@/lib/standings/types";
import { publish } from "@/lib/submissions/events";
import { toView } from "@/lib/submissions/queries";

/**
 * The one transition an administrator may make by hand: a finished row back
 * into the queue.
 *
 * One, and deliberately no history table behind it. A row has one verdict, the
 * current one; keeping the superseded judging alongside it is how a submission
 * comes to have two that both look valid, which miscounts the scoreboard and
 * can leave a rejudge unapplied. When there is a real reason to archive old
 * verdicts, that is a table to add deliberately.
 */

export interface RejudgeResult {
  /** Rows put back in the queue. */
  requeued: number;
  /** Passing submissions left alone because `includeAccepted` was not set. */
  keptAccepted: number;
  /** Inline-judged rows, which no runner can pick up. See below. */
  skippedInline: number;
  /**
   * Rows whose problem the registry no longer hands to any backend, so there is
   * nothing behind the queue they name. See below.
   */
  skippedNotDispatched: number;
}

/**
 * Whether the registry still has a backend to send this problem's work to.
 *
 * False once the problem has been rewritten as an inline judgement, and false
 * once it has left `content/` altogether — a submission outlives the directory
 * it was made against, since the foreign key protects the mirror row rather
 * than the source. `jobDetails` resolves a problem exactly this way, which is
 * why the two answers have to agree.
 */
function stillDispatched(problemSlug: string): boolean {
  const problem = problemBySlug(problemSlug);
  return problem !== undefined && !isInlineBackend(problem.backend);
}

/**
 * Puts finished submissions back in the queue.
 *
 * `includeAccepted` defaults to off: the expensive mistake is rejudging a whole
 * contest with a fixed checker and turning somebody's accepted submission into
 * a wrong answer, during the round, with no record of what it used to say.
 * Overwriting a pass has to be something an operator asked for in as many
 * words.
 *
 * Everything the last judging left is cleared, not just the state. A row
 * carrying an old `outcome` would sit in the queue rendering a stale AC badge,
 * and a stale badge on a row that is being re-evaluated is worse than no badge.
 *
 * `maxScore` is the one column kept, and it is kept because `reportDone` reads
 * it back: the denominator a verdict falls back to when the backend named none
 * is this column, and clearing it here would send that fallback to the registry
 * and rescore the submission out of whatever total the problem has since been
 * edited to.
 *
 * Inline rows are refused rather than requeued. Nothing signs as `inline`, so
 * no runner will ever claim one — putting it in the queue would leave it
 * spinning until the fuse burned through, six hours later, for an operator who
 * thought they had done something. Rejudging one means submitting again.
 *
 * A row whose problem the registry no longer dispatches is refused too, which
 * is the same conclusion reached from the other end. The queue named on the row
 * is real and has runners on it, and they would claim the row happily — but the
 * problem behind it has since become an inline judgement or left `content/`, so
 * `jobDetails` would answer each of them with `config: null`. Three attempts
 * get spent arriving back where the operator started, and the row lands in
 * `disrupted` blaming a runner that did nothing wrong.
 *
 * What that check deliberately stops short of is a problem re-pointed from one
 * backend to another. `backendId` is an opaque queue selector and not a lookup
 * — the note on the column in `lib/db/schema.ts` says so, and the fixture in
 * `lib/runner/queue.db.test.ts` queues under a name no backend has in order to
 * hold it to that — so which queue a submission belongs to is a fact recorded
 * when it was filed. Asking for one to be judged again is asking for it to be
 * run the way it was run, not for it to be moved; handing an old payload to a
 * service that has never seen the problem is a migration, and it wants an
 * operator behind it rather than a button they pressed for another reason.
 */
export async function rejudgeSubmissions(
  ids: string[],
  options: { includeAccepted?: boolean } = {},
): Promise<RejudgeResult> {
  const empty: RejudgeResult = {
    requeued: 0,
    keptAccepted: 0,
    skippedInline: 0,
    skippedNotDispatched: 0,
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

  // The registry is asked again rather than taken as read from the row, because
  // a rejudge is the one operation that happens far enough after the submission
  // for the answer to have changed underneath it.
  const notDispatched = external.filter(
    (row) => !stillDispatched(row.problemSlug),
  );
  const strandedIds = new Set(notDispatched.map((row) => row.id));
  const routed = external.filter((row) => !strandedIds.has(row.id));

  // Asked through the same predicate the standings use, so "already solved"
  // means here what it means on the board — including the case where a backend
  // reported no `accepted` flag and full marks is what settles it.
  const accepted = options.includeAccepted
    ? []
    : routed.filter((row) => isAccepted(row));
  const acceptedIds = new Set(accepted.map((row) => row.id));
  const targets = routed.filter((row) => !acceptedIds.has(row.id));

  if (targets.length === 0) {
    return {
      requeued: 0,
      keptAccepted: accepted.length,
      skippedInline: inline.length,
      skippedNotDispatched: notDispatched.length,
    };
  }

  const requeued = await db
    .update(submissions)
    .set({
      state: "queued" satisfies SubmissionState,
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
      //
      // `now()` rather than a `Date` from this process: a first submission
      // takes this column's default, so `claimJob` orders rows the database
      // stamped against rows this process stamped. Behind by the skew, a
      // requeued row sorts ahead of everything submitted during it — which is
      // the head-of-queue behaviour `queued_at` was introduced to stop.
      queuedAt: sql`now()`,
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
    skippedNotDispatched: notDispatched.length,
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

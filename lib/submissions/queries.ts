import { and, desc, eq } from "drizzle-orm";
import { failureReason } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import type { SubmissionRow } from "@/lib/db/schema";
import type { SubmissionListItem, SubmissionView } from "./types";

/**
 * The columns a view is made of, spelled out instead of taken as a whole row.
 *
 * `error` is in the list for `failureReason` rather than for the view, which
 * has no field of that name. What is deliberately *not* in it is `payload`:
 * capped at 512 KiB, genuinely that big when the submission is a file of
 * answers rather than a program, never sent to anybody by the function below,
 * and fifty to a page in `listSubmissions`. Narrowing here is what lets that
 * query stop asking for it, and keeping the two in step is the type checker's
 * job — a field added to `SubmissionView` and read off the row will not
 * compile until both this list and that `select` know about it.
 *
 * Every other caller passes a full `SubmissionRow`, which still satisfies this
 * structurally.
 */
export function toView(
  row: Pick<
    SubmissionRow,
    | "id"
    | "problemSlug"
    | "contestSlug"
    | "state"
    | "verdict"
    | "outcome"
    | "score"
    | "maxScore"
    | "accepted"
    | "error"
    | "runnerStatus"
    | "createdAt"
    | "judgedAt"
  >,
): SubmissionView {
  return {
    id: row.id,
    problemSlug: row.problemSlug,
    contestSlug: row.contestSlug,
    state: row.state,
    verdict: row.verdict ?? null,
    outcome: row.outcome,
    score: row.score,
    maxScore: row.maxScore,
    accepted: row.accepted,
    reason: failureReason(row),
    runnerStatus: row.runnerStatus,
    createdAt: row.createdAt.toISOString(),
    judgedAt: row.judgedAt?.toISOString() ?? null,
  };
}

export async function getSubmissionRow(
  id: string,
): Promise<SubmissionRow | undefined> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1);
  return row;
}

/**
 * The row a client's nonce already produced, if it produced one.
 *
 * Keyed by both columns because the unique index is: a nonce is a client's
 * private counter, and one person's must not be able to name another's
 * submission. Serves the read before the insert and the recovery after a lost
 * race on it — see `submissions.clientNonce`.
 */
export async function findSubmissionByNonce(
  handle: string,
  clientNonce: string,
): Promise<SubmissionRow | undefined> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.handle, handle),
        eq(submissions.clientNonce, clientNonce),
      ),
    )
    .limit(1);
  return row;
}

export async function listSubmissions(options: {
  handle?: string;
  problemSlug?: string;
  contestSlug?: string;
  limit?: number;
}): Promise<SubmissionListItem[]> {
  const filters = [
    options.handle ? eq(submissions.handle, options.handle) : undefined,
    options.problemSlug
      ? eq(submissions.problemSlug, options.problemSlug)
      : undefined,
    options.contestSlug
      ? eq(submissions.contestSlug, options.contestSlug)
      : undefined,
  ].filter((clause) => clause !== undefined);

  // The display name is a join rather than a lookup: people supply their own,
  // so the authoritative copy is one table over and the foreign key guarantees
  // the row is there.
  const rows = await db
    .select({
      submission: {
        id: submissions.id,
        handle: submissions.handle,
        problemSlug: submissions.problemSlug,
        contestSlug: submissions.contestSlug,
        state: submissions.state,
        verdict: submissions.verdict,
        outcome: submissions.outcome,
        score: submissions.score,
        maxScore: submissions.maxScore,
        accepted: submissions.accepted,
        error: submissions.error,
        runnerStatus: submissions.runnerStatus,
        createdAt: submissions.createdAt,
        judgedAt: submissions.judgedAt,
      },
      problemTitle: problems.title,
      displayName: accounts.displayName,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.slug, submissions.problemSlug))
    .innerJoin(accounts, eq(accounts.handle, submissions.handle))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(submissions.createdAt))
    .limit(options.limit ?? 50);

  return rows.map((row) => ({
    ...toView(row.submission),
    handle: row.submission.handle,
    displayName: row.displayName,
    problemTitle: row.problemTitle,
  }));
}

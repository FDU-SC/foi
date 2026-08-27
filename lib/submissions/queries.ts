import { and, desc, eq } from "drizzle-orm";
import { failureReason } from "@/lib/backend/types";
import { db } from "@/lib/db";
import { accounts, problems, submissions } from "@/lib/db/schema";
import type { SubmissionRow } from "@/lib/db/schema";
import type { SubmissionListItem, SubmissionView } from "./types";

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

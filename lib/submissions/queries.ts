import { and, desc, eq } from "drizzle-orm";
import { failureReason } from "@/lib/backend/types";
import { db } from "@/lib/db";
import {
  accounts,
  judgingSessions,
  problems,
  submissions,
} from "@/lib/db/schema";
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
    | "createdAt"
    | "judgedAt"
  >,
  runnerStatus?: string | null,
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
    runnerStatus: runnerStatus ?? null,
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

export async function getRunnerStatus(
  submissionId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ runnerStatus: judgingSessions.runnerStatus })
    .from(judgingSessions)
    .where(eq(judgingSessions.submissionId, submissionId))
    .limit(1);
  return row?.runnerStatus ?? null;
}

export async function findSubmissionByNonce(
  uid: number,
  clientNonce: string,
): Promise<SubmissionRow | undefined> {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.uid, uid),
        eq(submissions.clientNonce, clientNonce),
      ),
    )
    .limit(1);
  return row;
}

export async function listSubmissions(options: {
  uid?: number;
  problemSlug?: string;
  contestSlug?: string;
  limit?: number;
}): Promise<SubmissionListItem[]> {
  const filters = [
    options.uid ? eq(submissions.uid, options.uid) : undefined,
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
        uid: submissions.uid,
        problemSlug: submissions.problemSlug,
        contestSlug: submissions.contestSlug,
        state: submissions.state,
        verdict: submissions.verdict,
        outcome: submissions.outcome,
        score: submissions.score,
        maxScore: submissions.maxScore,
        accepted: submissions.accepted,
        error: submissions.error,
        createdAt: submissions.createdAt,
        judgedAt: submissions.judgedAt,
      },
      runnerStatus: judgingSessions.runnerStatus,
      problemTitle: problems.title,
      nickname: accounts.nickname,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.slug, submissions.problemSlug))
    .innerJoin(accounts, eq(accounts.uid, submissions.uid))
    .leftJoin(
      judgingSessions,
      eq(judgingSessions.submissionId, submissions.id),
    )
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(submissions.createdAt))
    .limit(options.limit ?? 50);

  return rows.map((row) => ({
    ...toView(row.submission, row.runnerStatus),
    uid: row.submission.uid,
    nickname: row.nickname,
    problemTitle: row.problemTitle,
  }));
}

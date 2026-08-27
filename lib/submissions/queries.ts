import { and, desc, eq } from "drizzle-orm";
import { failureReason, type SubmissionState } from "@/lib/backend/types";
import { db } from "@/lib/db";
import {
  accounts,
  judgingQueue,
  problems,
  submissions,
} from "@/lib/db/schema";
import type { SubmissionRow } from "@/lib/db/schema";
import type { SubmissionListItem, SubmissionView } from "./types";

/**
 * Derive the view-level 4-state from the DB record state + queue presence.
 */
function deriveViewState(
  recordState: SubmissionRow["state"],
  queueState?: string | null,
): SubmissionState {
  if (recordState !== "pending") return recordState;
  if (queueState === "claimed") return "judging";
  return "queued";
}

export function toView(
  row: Pick<
    SubmissionRow,
    | "id"
    | "problemSlug"
    | "contestSlug"
    | "state"
    | "result"
    | "detail"
    | "error"
    | "createdAt"
    | "judgedAt"
  >,
  queueInfo?: { state?: string | null; runnerStatus?: string | null } | null,
): SubmissionView {
  return {
    id: row.id,
    problemSlug: row.problemSlug,
    contestSlug: row.contestSlug,
    state: deriveViewState(row.state, queueInfo?.state),
    result: row.result ?? null,
    detail: row.detail ?? null,
    reason: failureReason({ state: deriveViewState(row.state, queueInfo?.state), error: row.error }),
    runnerStatus: queueInfo?.runnerStatus ?? null,
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

export async function getQueueInfo(
  submissionId: string,
): Promise<{ state: string; runnerStatus: string | null } | null> {
  const [row] = await db
    .select({
      state: judgingQueue.state,
      runnerStatus: judgingQueue.runnerStatus,
    })
    .from(judgingQueue)
    .where(eq(judgingQueue.submissionId, submissionId))
    .limit(1);
  return row ?? null;
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
        result: submissions.result,
        detail: submissions.detail,
        error: submissions.error,
        createdAt: submissions.createdAt,
        judgedAt: submissions.judgedAt,
      },
      queueState: judgingQueue.state,
      runnerStatus: judgingQueue.runnerStatus,
      problemTitle: problems.title,
      nickname: accounts.nickname,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.slug, submissions.problemSlug))
    .innerJoin(accounts, eq(accounts.uid, submissions.uid))
    .leftJoin(
      judgingQueue,
      eq(judgingQueue.submissionId, submissions.id),
    )
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(submissions.createdAt))
    .limit(options.limit ?? 50);

  return rows.map((row) => ({
    ...toView(row.submission, {
      state: row.queueState,
      runnerStatus: row.runnerStatus,
    }),
    uid: row.submission.uid,
    nickname: row.nickname,
    problemTitle: row.problemTitle,
  }));
}

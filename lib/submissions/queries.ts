import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, submissions, users } from "@/lib/db/schema";
import type { SubmissionRow } from "@/lib/db/schema";
import type { SubmissionListItem, SubmissionView } from "./types";

export function toView(row: SubmissionRow): SubmissionView {
  return {
    id: row.id,
    problemSlug: row.problemSlug,
    contestId: row.contestId,
    state: row.state,
    verdict: row.verdict ?? null,
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

export async function listSubmissions(options: {
  userId?: string;
  problemSlug?: string;
  contestId?: string;
  limit?: number;
}): Promise<SubmissionListItem[]> {
  const filters = [
    options.userId ? eq(submissions.userId, options.userId) : undefined,
    options.problemSlug
      ? eq(submissions.problemSlug, options.problemSlug)
      : undefined,
    options.contestId ? eq(submissions.contestId, options.contestId) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await db
    .select({
      submission: submissions,
      userHandle: users.handle,
      userDisplayName: users.displayName,
      problemTitle: problems.title,
    })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.userId))
    .innerJoin(problems, eq(problems.slug, submissions.problemSlug))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(submissions.createdAt))
    .limit(options.limit ?? 50);

  return rows.map((row) => ({
    ...toView(row.submission),
    userHandle: row.userHandle,
    userDisplayName: row.userDisplayName,
    problemTitle: row.problemTitle,
  }));
}

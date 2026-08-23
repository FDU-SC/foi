import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, submissions } from "@/lib/db/schema";
import type { SubmissionRow } from "@/lib/db/schema";
import { getMember } from "@/lib/roster/registry";
import type { SubmissionListItem, SubmissionView } from "./types";

export function toView(row: SubmissionRow): SubmissionView {
  return {
    id: row.id,
    problemSlug: row.problemSlug,
    contestSlug: row.contestSlug,
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
      submission: submissions,
      problemTitle: problems.title,
    })
    .from(submissions)
    .innerJoin(problems, eq(problems.slug, submissions.problemSlug))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(submissions.createdAt))
    .limit(options.limit ?? 50);

  // The display name used to come from a join. It comes from the roster now,
  // which also means a rename in `content/roster/` shows up on historical
  // submissions without touching a row.
  return rows.map((row) => {
    const member = getMember(row.submission.handle);
    return {
      ...toView(row.submission),
      handle: row.submission.handle,
      displayName: member?.displayName ?? row.submission.handle,
      problemTitle: row.problemTitle,
    };
  });
}

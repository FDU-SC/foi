import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { rowScope } from "@/lib/authz/filter";
import type { Viewer } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { problemsFor } from "./access";
import { viewsFor, type ProblemProgress, type ProgressSubmission } from "./views";

/** Own progress within one contest, interpreted only by its problem content. */
export async function progressFor(
  contestSlug: string,
  viewer: Viewer,
  now = new Date(),
): Promise<Map<string, ProblemProgress>> {
  const progress = new Map<string, ProblemProgress>();
  if (viewer.uid === null || !contestFor(contestSlug, viewer, now)) return progress;
  const interpreters = new Map(
    problemsFor(contestSlug, viewer, now).flatMap(({ ref }) => {
      const interpret = viewsFor(ref.problem.slug).progress;
      return interpret ? [[ref.problem.slug, interpret] as const] : [];
    }),
  );
  if (interpreters.size === 0) return progress;
  const scope = rowScope("submission.read", viewer);
  const rows = scope.kind === "none" ? [] : await db
    .select({
      id: submissions.id,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      result: submissions.result,
      createdAt: submissions.createdAt,
      judgedAt: submissions.judgedAt,
    })
    .from(submissions)
    .where(and(
      eq(submissions.uid, viewer.uid),
      eq(submissions.contestSlug, contestSlug),
      inArray(submissions.problemSlug, [...interpreters.keys()]),
      scope.kind === "where" ? scope.sql : undefined,
    ))
    .orderBy(asc(submissions.createdAt), asc(submissions.id));
  const histories = new Map<string, ProgressSubmission[]>();
  for (const { problemSlug, ...row } of rows) {
    const history = histories.get(problemSlug) ?? [];
    history.push(row);
    histories.set(problemSlug, history);
  }
  for (const [slug, interpret] of interpreters) {
    progress.set(slug, interpret(histories.get(slug) ?? []));
  }
  return progress;
}

import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { rowScope } from "@/lib/authz/filter";
import type { Viewer } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { pairKey } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { problemsFor } from "./access";
import { viewsFor, type ProblemProgress, type ProgressSubmission } from "./views";

/**
 * Own progress in these contests, keyed by `pairKey` and interpreted only by
 * each problem's content. Work done in one contest never counts in another.
 */
export async function progressFor(
  contestSlugs: readonly string[],
  viewer: Viewer,
  now = new Date(),
): Promise<Map<string, ProblemProgress>> {
  const progress = new Map<string, ProblemProgress>();
  if (viewer.uid === null) return progress;
  const refs = contestSlugs
    .filter((slug) => contestFor(slug, viewer, now))
    .flatMap((slug) => problemsFor(slug, viewer, now))
    .flatMap(({ ref }) => {
      const interpret = viewsFor(ref.problem.slug).progress;
      return interpret ? [{ ref, interpret }] : [];
    });
  if (refs.length === 0) return progress;
  const interpreters = new Map(refs.map(({ ref, interpret }) =>
    [pairKey(ref.contest.slug, ref.problem.slug), interpret]));
  const contests = [...new Set(refs.map(({ ref }) => ref.contest.slug))];
  const problems = [...new Set(refs.map(({ ref }) => ref.problem.slug))];
  const scope = rowScope("submission.read", viewer);
  const rows = scope.kind === "none" ? [] : await db
    .select({
      id: submissions.id,
      contestSlug: submissions.contestSlug,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      result: submissions.result,
      createdAt: submissions.createdAt,
      judgedAt: submissions.judgedAt,
    })
    .from(submissions)
    .where(and(
      eq(submissions.uid, viewer.uid),
      inArray(submissions.contestSlug, contests),
      inArray(submissions.problemSlug, problems),
      scope.kind === "where" ? scope.sql : undefined,
    ))
    .orderBy(asc(submissions.createdAt), asc(submissions.id));
  const histories = new Map<string, ProgressSubmission[]>();
  for (const { contestSlug, problemSlug, ...row } of rows) {
    const key = pairKey(contestSlug, problemSlug);
    if (!interpreters.has(key)) continue;
    const history = histories.get(key) ?? [];
    history.push(row);
    histories.set(key, history);
  }
  for (const [key, interpret] of interpreters) {
    progress.set(key, interpret(histories.get(key) ?? []));
  }
  return progress;
}

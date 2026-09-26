import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { rowScope } from "@/lib/authz/filter";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { pairKey } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { problemsFor } from "./access";
import { viewsFor, type ProblemProgress, type ProgressSubmission } from "./views";

export interface PairSubmission extends ProgressSubmission {
  contestSlug: string;
  problemSlug: string;
}

/** Whether this problem's content interprets progress at all. */
export function interpretsProgress(ref: ContestProblemRef): boolean {
  return viewsFor(ref.problem.slug).progress !== undefined;
}

/** Rows grouped into each pair's history, keyed by `pairKey`, in the order given. */
export function historiesOf(
  rows: readonly PairSubmission[],
): Map<string, ProgressSubmission[]> {
  const histories = new Map<string, ProgressSubmission[]>();
  for (const { contestSlug, problemSlug, ...row } of rows) {
    const key = pairKey(contestSlug, problemSlug);
    const history = histories.get(key) ?? [];
    history.push(row);
    histories.set(key, history);
  }
  return histories;
}

/**
 * Each pair's history, oldest first, through its own problem's content,
 * keyed by `pairKey`. Pairs whose content interprets nothing are left out.
 */
export function interpretProgress(
  refs: readonly ContestProblemRef[],
  histories: ReadonlyMap<string, readonly ProgressSubmission[]>,
): Map<string, ProblemProgress> {
  const progress = new Map<string, ProblemProgress>();
  for (const ref of refs) {
    const interpret = viewsFor(ref.problem.slug).progress;
    if (!interpret) continue;
    const key = pairKey(ref.contest.slug, ref.problem.slug);
    progress.set(key, interpret(histories.get(key) ?? []));
  }
  return progress;
}

/**
 * The submission that first made a pair count as solved: the end of the
 * shortest history prefix its content calls solved. Undefined when none is.
 */
export function solvingSubmission(
  ref: ContestProblemRef,
  history: readonly ProgressSubmission[],
): ProgressSubmission | undefined {
  const interpret = viewsFor(ref.problem.slug).progress;
  if (!interpret) return undefined;
  for (let end = 1; end <= history.length; end++) {
    if (interpret(history.slice(0, end)).state === "solved") return history[end - 1];
  }
  return undefined;
}

/**
 * Own progress in these contests, keyed by `pairKey` and interpreted only by
 * each problem's content. Work done in one contest never counts in another.
 */
export async function progressFor(
  contestSlugs: readonly string[],
  viewer: Viewer,
  now = new Date(),
): Promise<Map<string, ProblemProgress>> {
  if (viewer.uid === null) return new Map();
  const refs = contestSlugs
    .filter((slug) => contestFor(slug, viewer, now))
    .flatMap((slug) => problemsFor(slug, viewer, now))
    .map(({ ref }) => ref)
    .filter(interpretsProgress);
  if (refs.length === 0) return new Map();
  const contests = [...new Set(refs.map((ref) => ref.contest.slug))];
  const problems = [...new Set(refs.map((ref) => ref.problem.slug))];
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
  return interpretProgress(refs, historiesOf(rows));
}

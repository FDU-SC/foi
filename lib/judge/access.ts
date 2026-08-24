import type { Viewer } from "@/lib/auth/viewer";
import { problemFor } from "@/lib/problems/access";
import { allProblems } from "@/lib/problems/registry";
import { judges } from "@/judges.config";

/**
 * Which judges a person may know about.
 *
 * There was no answer to this before: `/judges` and its API required a login
 * and nothing else, so every account saw every judge. Redaction hid the
 * address and which problem each queue entry was for, but not the judge's
 * existence, its health, or how deep its queue ran — and a judge that only
 * serves an unopened round announces that round by being busy. Gating the
 * statement while leaving that visible only moves where the leak is.
 *
 * A judge is therefore shown when the viewer can see at least one problem it
 * serves. Holders of `judge.inspect` see all of them, including ones nothing
 * references, because their job is the infrastructure rather than the round.
 *
 * **The problem set is derived, not declared.** Every problem already names
 * its judge in `problem.judge.id`, so inverting that index is exact and cannot
 * drift. Having judges list their problems instead would duplicate the
 * relationship and reintroduce precisely the failure this codebase keeps
 * hitting: a second place to remember, and a new problem whose judge silently
 * has the wrong audience because nobody updated it.
 */
function buildIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const problem of allProblems()) {
    const slugs = index.get(problem.judge.id);
    if (slugs) slugs.push(problem.slug);
    else index.set(problem.judge.id, [problem.slug]);
  }

  return index;
}

const problemsByJudge = buildIndex();

/** Problem slugs this judge serves, per the problem registry. */
export function problemsServedBy(judgeId: string): string[] {
  return problemsByJudge.get(judgeId) ?? [];
}

/** Judges configured but named by no problem — nothing routes to them. */
export function orphanedJudges(): string[] {
  return Object.keys(judges).filter((id) => problemsServedBy(id).length === 0);
}

/**
 * Whether this viewer may know the judge exists.
 *
 * An inspector always may, including for judges nothing routes to — that gap
 * is theirs to notice. Everyone else needs one problem on it that they can
 * already see: with none, the judge's queue depth is a readout of activity on
 * material they have not been shown.
 *
 * Asked through `problemFor` rather than the raw gate so the two answers
 * cannot disagree — a preview holder sees an embargoed problem, so they see
 * its judge too, and nothing extra had to be written to make that true.
 */
export function canSeeJudge(
  judgeId: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  if (viewer.can("judge.inspect")) return true;

  return problemsServedBy(judgeId).some(
    (slug) => problemFor(slug, viewer, now) !== undefined,
  );
}

/** The judge ids this viewer may be shown, in configuration order. */
export function judgesFor(viewer: Viewer, now = new Date()): string[] {
  return Object.keys(judges).filter((id) => canSeeJudge(id, viewer, now));
}

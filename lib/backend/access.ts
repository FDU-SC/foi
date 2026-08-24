import type { Viewer } from "@/lib/auth/viewer";
import { problemFor } from "@/lib/problems/access";
import { allProblems } from "@/lib/problems/registry";
import { backends } from "@/backends.config";

/**
 * Which backends a person may know about.
 *
 * There was no answer to this before: `/judges` and its API required a login
 * and nothing else, so every account saw every backend. Redaction hid the
 * address and which problem each queue entry was for, but not the backend's
 * existence, its health, or how deep its queue ran — and a backend that only
 * serves an unopened round announces that round by being busy. Gating the
 * statement while leaving that visible only moves where the leak is.
 *
 * A backend is therefore shown when the viewer can see at least one problem it
 * serves. Holders of `backend.inspect` see all of them, including ones nothing
 * references, because their job is the infrastructure rather than the round.
 *
 * **The problem set is derived, not declared.** Every problem already names
 * its backend in `problem.backend.id`, so inverting that index is exact and
 * cannot drift. Having backends list their problems instead would duplicate
 * the relationship and reintroduce precisely the failure this codebase keeps
 * hitting: a second place to remember, and a new problem whose backend
 * silently has the wrong audience because nobody updated it.
 */
function buildIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const problem of allProblems()) {
    const slugs = index.get(problem.backend.id);
    if (slugs) slugs.push(problem.slug);
    else index.set(problem.backend.id, [problem.slug]);
  }

  return index;
}

const problemsByBackend = buildIndex();

/** Problem slugs this backend serves, per the problem registry. */
export function problemsServedBy(backendId: string): string[] {
  return problemsByBackend.get(backendId) ?? [];
}

/** Backends configured but named by no problem — nothing routes to them. */
export function orphanedBackends(): string[] {
  return Object.keys(backends).filter((id) => problemsServedBy(id).length === 0);
}

/**
 * Whether this viewer may know the backend exists.
 *
 * An inspector always may, including for backends nothing routes to — that gap
 * is theirs to notice. Everyone else needs one problem on it that they can
 * already see: with none, the backend's queue depth is a readout of activity
 * on material they have not been shown.
 *
 * Asked through `problemFor` rather than the raw gate so the two answers
 * cannot disagree — a preview holder sees an embargoed problem, so they see
 * its backend too, and nothing extra had to be written to make that true.
 */
export function canSeeBackend(
  backendId: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  if (viewer.can("backend.inspect")) return true;

  return problemsServedBy(backendId).some(
    (slug) => problemFor(slug, viewer, now) !== undefined,
  );
}

/** The backend ids this viewer may be shown, in configuration order. */
export function backendsFor(viewer: Viewer, now = new Date()): string[] {
  return Object.keys(backends).filter((id) => canSeeBackend(id, viewer, now));
}

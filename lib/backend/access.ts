import type { Viewer } from "@/lib/auth/viewer";
import { problemFor } from "@/lib/problems/access";
import { externallyJudged } from "@/lib/problems/registry";
import { backends } from "./registry";

/**
 * Which problems each backend serves, and who may know a backend exists.
 *
 * The derived index and the one gate built on it, which are the same subject:
 * a backend is visible to somebody exactly when a problem it serves is.
 * Deployment-time assertions are `./boot.ts`.
 */

/**
 * Which backends a person may know about.
 *
 * Redaction is not enough on its own: it hides the address and which problem
 * each queue entry is for, but not the backend's existence or how deep its
 * queue runs — and a backend that only serves an unopened round announces that
 * round by being busy. Gating the statement while leaving that visible only
 * moves where the leak is.
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

  // Inline problems are absent by construction: they have no backend to serve
  // them, and filing them under a placeholder would make a real backend look
  // busy to the audience gate below.
  for (const problem of externallyJudged()) {
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
 * The mirror image: backends some problem routes to that nothing declares.
 *
 * This is the failure a declared list exists to catch, and it has to be said
 * at startup or it is caught at the worst moment. A problem carrying a
 * misspelt `backend.id` loads fine — the schema asks for a non-empty string
 * and nothing more — and stays fine right up to the first submission, which
 * gets a 500 from `resolveBackend` naming a backend nobody meant to have.
 *
 * A warning rather than a refusal, because the blast radius is one problem and
 * the deployment around it works — see `backendRegistryWarnings` in
 * `./boot.ts`. `assertBackendActionUrls` is the harder cousin, and it is
 * harder because a missing address cannot be told apart from a backend that
 * legitimately needs none.
 */
export function undeclaredBackends(): string[] {
  return [...problemsByBackend.keys()].filter((id) => !backends[id]);
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

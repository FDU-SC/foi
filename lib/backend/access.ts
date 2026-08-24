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
 * Backends carrying real traffic that fall back to the shared signing key,
 * reported only when that actually weakens something.
 *
 * The weakness is a plural one: sharing a key with nobody is not sharing. What
 * makes it matter is a *second service* holding the same value, because then
 * compromising the softer of the two yields a signature the other accepts —
 * including for reporting a verdict on its submissions, which
 * `app/api/judge/callback/route.ts` re-checks per backend precisely so that
 * distinct keys can stop it.
 *
 * So the count is over distinct addresses, not over entries. Every backend
 * here defaults to the same mock on `:4100`, and several deployments really do
 * put two kinds of problem on one service — those entries are one process with
 * one key, and telling somebody to split a key they cannot split is how a
 * warning becomes something everybody learns to scroll past. The ids are all
 * returned once it does fire, because those are what the operator has to go
 * and configure.
 *
 * **Which backends count is derived, not declared**, for the same reason the
 * index above is. #22 proposed requiring all six entries to be filled in, which
 * would have meant configuring a key for a backend nothing routes to, and would
 * have made `.env.production.example` a second list to keep in step with
 * `backends.config.ts`. `problemsServedBy` already knows which backends a
 * deployment actually uses, so the check is built on that.
 */
export function backendsSharingSecret(): string[] {
  const borrowing = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0 && !backends[id].secret,
  );

  const services = new Set(borrowing.map((id) => backends[id].url));
  return services.size > 1 ? borrowing : [];
}

/**
 * Said at startup, next to the enrollment and contest warnings.
 *
 * Not in `assertEnv`, and not a refusal to boot. Not in `assertEnv` because
 * `lib/env.ts` would have to import the backend access layer to ask the
 * question, dragging the whole content registry into environment validation —
 * the knowledge of which backends are in use lives here, so the check does
 * too. Not a refusal because two backends sharing a key is a weakening rather
 * than a fault: everything still works, and a boot refused over it would take
 * a contest down to fix a problem that was not stopping the contest.
 */
export function backendSecretWarnings(): string[] {
  const sharing = backendsSharingSecret();
  if (sharing.length === 0) return [];

  return [
    `题目后端 ${sharing.join("、")} 都在使用共享的 FOI_BACKEND_SECRET：` +
      `其中任何一台被攻破，它的签名对其余几台同样有效，包括代替它们回报评测结果。` +
      `为每台服务设置各自的 FOI_BACKEND_<名字>_SECRET，并同步到后端本身` +
      `（指向同一地址的多个条目是同一个服务，填相同的值）。`,
  ];
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

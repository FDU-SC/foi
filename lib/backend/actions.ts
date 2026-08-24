import type { Viewer } from "@/lib/auth/viewer";
import { problemFor } from "@/lib/problems/access";
import {
  DEFAULT_ACTION_RATE_LIMIT,
  type ActionRateLimit,
  type ProblemConfig,
} from "@/lib/problems/types";

/**
 * How anything reaching a problem's interactive endpoints obtains one.
 *
 * The same shape as the problem, contest, submission and backend gates, and
 * for the same reason: there is no way to ask for an action without saying who
 * is asking. Two of the four refusals below are ones the route would have had
 * to remember on its own, and the whole history of this codebase is rules that
 * got remembered in three places and missed in a fourth.
 *
 * Undefined for every refusal, so the caller answers 404 to all of them. The
 * distinctions matter here and must not reach the browser: telling somebody
 * that `spawn` exists on a problem they cannot see says the problem exists,
 * and telling them `poll` is not declared enumerates what is.
 */
export interface ResolvedAction {
  problem: ProblemConfig;
  action: string;
  /** The action's own limit, or the kernel default when it declared none. */
  rateLimit: ActionRateLimit;
}

export function actionFor(
  slug: string,
  action: string,
  viewer: Viewer,
  now = new Date(),
): ResolvedAction | undefined {
  // Their own view, then `gate.visible` on top of it — the pair the submission
  // path uses, refusing the same two groups of people for the same two
  // reasons. The first stops somebody acting on a problem that is not theirs
  // to see; the second stops a holder of `problem.viewAll` acting on one that
  // has not opened, because proofreading a round should no more start its
  // containers than it should queue work on its judges.
  //
  // Not `AS_PLAYER`: a problem given to 校队 has no audience under a viewer
  // with no groups, so the very members it was written for would be refused.
  const open = problemFor(slug, viewer, now);
  if (!open?.gate.visible) return undefined;

  // Undeclared is indistinguishable from absent, and that is also what stops
  // this being a general proxy: without the whitelist the path segment would
  // relay anything the backend exposes, `/judge` included.
  const declared = open.config.backend.actions[action];
  if (!declared) return undefined;

  return {
    problem: open.config,
    action,
    rateLimit: declared.rateLimit ?? DEFAULT_ACTION_RATE_LIMIT,
  };
}

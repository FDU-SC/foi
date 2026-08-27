import type { Viewer } from "@/lib/permissions/viewer";
import { problemFor } from "./access";
import {
  DEFAULT_ACTION_RATE_LIMIT,
  isInlineBackend,
  type ActionRateLimit,
  type ProblemConfig,
} from "./types";

/**
 * How anything reaching a problem's interactive endpoints obtains one.
 *
 * The same shape as the problem, contest, submission and backend gates, and
 * for the same reason: there is no way to ask for an action without saying who
 * is asking. Two of the four refusals below are ones a route would otherwise
 * have to remember on its own.
 *
 * Undefined for every refusal, so the caller answers 404 to all of them. The
 * distinctions matter here and must not reach the browser: telling somebody
 * that `spawn` exists on a problem they cannot see says the problem exists,
 * and telling them `poll` is not declared enumerates what is.
 */
export interface ResolvedAction {
  problem: ProblemConfig;
  action: string;
  /**
   * The backend to relay to, already narrowed out of the union.
   *
   * Carried here so the route never has to ask again whether this problem is
   * inline: reaching a `ResolvedAction` at all is proof that it is not, and
   * handing back the id is cheaper than making every caller re-derive it.
   */
  backendId: string;
  /** The action's own limit, or the kernel default when it declared none. */
  rateLimit: ActionRateLimit;
}

export function actionFor(
  slug: string,
  action: string,
  viewer: Viewer,
  now = new Date(),
): ResolvedAction | undefined {
  // Their own view, then `open` on top of it — the same pair the submission
  // path uses, refusing the same three groups for the same three reasons. Not
  // theirs to see; theirs to see but not yet started, which is why a holder of
  // `problem.viewAll` proofreading a round may not start its containers any
  // more than they may queue work on its judges; or retired, where the
  // statement stays readable but nothing new goes to the backend.
  //
  // Not `AS_PLAYER`: a problem given to 校队 has no audience under a viewer
  // with no groups, so the very members it was written for would be refused.
  const open = problemFor(slug, viewer, now);
  if (!open?.open) return undefined;

  // An inline problem has no service to relay to, so every action on it is
  // undeclared by construction — same 404, same reason as any other name that
  // is not on the list.
  if (isInlineBackend(open.config.backend)) return undefined;

  // Undeclared is indistinguishable from absent, and that is also what stops
  // this being a general proxy: without the whitelist the path segment would
  // relay anything the backend exposes, `/judge` included.
  const declared = open.config.backend.actions[action];
  if (!declared) return undefined;

  return {
    problem: open.config,
    action,
    backendId: open.config.backend.id,
    rateLimit: declared.rateLimit ?? DEFAULT_ACTION_RATE_LIMIT,
  };
}

import {
  DEFAULT_ACTION_RATE_LIMIT,
  isInlineBackend,
  type ActionRateLimit,
  type ProblemConfig,
} from "./types";

export interface ResolvedAction {
  problem: ProblemConfig;
  action: string;

  backendId: string;

  rateLimit: ActionRateLimit;
}

/**
 * The interactive action a client named, if this problem declares it.
 *
 * Existence only — whether the caller may invoke it is `problem.invoke`, asked
 * separately so that "no such action" and "not allowed" stay distinguishable
 * at the enforcement point.
 */
export function declaredAction(
  problem: ProblemConfig,
  action: string,
): ResolvedAction | undefined {
  if (isInlineBackend(problem.backend)) return undefined;

  const declared = problem.backend.actions[action];
  if (!declared) return undefined;

  return {
    problem,
    action,
    backendId: problem.backend.id,
    rateLimit: declared.rateLimit ?? DEFAULT_ACTION_RATE_LIMIT,
  };
}

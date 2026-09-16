import type { Denial } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { contestEntryFor } from "@/lib/contests/access";
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

  if (!Object.hasOwn(problem.backend.actions, action)) return undefined;
  const declared = problem.backend.actions[action];
  if (!declared) return undefined;

  return {
    problem,
    action,
    backendId: problem.backend.id,
    rateLimit: declared.rateLimit ?? DEFAULT_ACTION_RATE_LIMIT,
  };
}

export type InvokeGate =
  | { kind: "allowed"; ref: ContestProblemRef; resolved: ResolvedAction }
  | { kind: "denied"; denial: Denial }
  | { kind: "missing" };

/** Preserve entry, authorization, then declaration order for both callers. */
export function invokeFor(
  contestSlug: string,
  problemSlug: string,
  action: string,
  viewer: Viewer,
  now = new Date(),
): InvokeGate {
  const entry = contestEntryFor(contestSlug, problemSlug, viewer, now);
  if (!entry.ok) return { kind: "denied", denial: entry.denial };

  const decision = authorize("problem.invoke", entry.ref, viewer, {
    now,
    invocation: action,
  });
  if (!decision.allow) return { kind: "denied", denial: decision };

  const resolved = declaredAction(entry.ref.problem, action);
  return resolved
    ? { kind: "allowed", ref: entry.ref, resolved }
    : { kind: "missing" };
}

import type { Viewer } from "@/lib/permissions/viewer";
import { problemFor } from "./access";
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

export function actionFor(
  slug: string,
  action: string,
  viewer: Viewer,
  now = new Date(),
): ResolvedAction | undefined {

  const open = problemFor(slug, viewer, now);
  if (!open?.open) return undefined;

  if (isInlineBackend(open.config.backend)) return undefined;

  const declared = open.config.backend.actions[action];
  if (!declared) return undefined;

  return {
    problem: open.config,
    action,
    backendId: open.config.backend.id,
    rateLimit: declared.rateLimit ?? DEFAULT_ACTION_RATE_LIMIT,
  };
}

import { denialFor } from "@/lib/authz/actions";
import { denied, type Denial } from "@/lib/authz/adapters";
import { authorize } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { contestEntryFor } from "@/lib/contests/access";
import type { ContestConfig } from "@/lib/contests/types";
import { problemBySlug } from "@/lib/problems/registry";
import {
  submitRateLimit,
  type ActionRateLimit,
  type ProblemConfig,
} from "@/lib/problems/types";

export type SubmitGate =
  | {
      ok: true;
      problem: ProblemConfig;

      contest: ContestConfig | null;

      rateLimit: ActionRateLimit;
    }
  | { ok: false; denial: Denial };

/**
 * Whether this submission may be queued, and which contest it counts for.
 *
 * Two questions, asked in order and never merged: may this person compete in
 * the contest they named, and may they submit to this problem as part of it.
 * Keeping them apart is what stops "can read the contest" from drifting into
 * "can compete in it".
 */
export function submitFor(
  slug: string,
  contestSlug: string | null | undefined,
  viewer: Viewer,
  now = new Date(),
): SubmitGate {
  const problem = problemBySlug(slug);
  if (!problem) return { ok: false, denial: denied(denialFor("problem.read")) };

  let contest: ContestConfig | null = null;
  let rateLimit: ActionRateLimit | undefined;

  if (contestSlug !== null && contestSlug !== undefined) {
    const round = contestEntryFor(contestSlug, slug, viewer, now);
    if (!round.ok) return { ok: false, denial: round.denial };

    contest = round.contest;
    rateLimit = round.problemEntry.rateLimit;
  }

  const decision = authorize("problem.submit", problem, viewer, { now, contest });
  if (!decision.allow) return { ok: false, denial: decision };

  return {
    ok: true,
    problem,
    contest,
    rateLimit: submitRateLimit(problem, rateLimit),
  };
}

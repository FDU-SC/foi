import type { ResolvedUser } from "@/lib/accounts/types";
import { viewerFor } from "@/lib/permissions/viewer";
import { contestEntryFor } from "@/lib/contests/access";
import type { ContestConfig } from "@/lib/contests/types";
import { problemFor } from "@/lib/problems/access";
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
  | { ok: false; reason: "no-problem" | "contest-mismatch" | "not-entered" };

export function submitFor(
  slug: string,
  contestSlug: string | null | undefined,
  user: Pick<ResolvedUser, "handle" | "groups">,
  now = new Date(),
): SubmitGate {
  const viewer = viewerFor(user);

  const open = problemFor(slug, viewer, now);
  if (!open?.open) return { ok: false, reason: "no-problem" };

  const problem = open.config;

  if (contestSlug === null || contestSlug === undefined) {
    return { ok: true, problem, contest: null, rateLimit: submitRateLimit(problem) };
  }

  const round = contestEntryFor(contestSlug, slug, user, now);
  if (!round.ok) return { ok: false, reason: round.reason };

  return {
    ok: true,
    problem,
    contest: round.contest,
    rateLimit: submitRateLimit(problem, round.problemEntry.rateLimit),
  };
}

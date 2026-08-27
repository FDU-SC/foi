import type { Verdict } from "@/lib/backend/types";

export interface VerdictColumns {
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
  outcome: string;
}

export function verdictColumns(
  verdict: Verdict,
  fallbackMaxScore: number | null,
): VerdictColumns {
  return {
    score: verdict.score ?? null,

    maxScore: verdict.maxScore ?? fallbackMaxScore,

    accepted: verdict.accepted ?? null,

    outcome: verdict.status,
  };
}

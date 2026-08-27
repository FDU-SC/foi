import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import { presentation as declared } from "@/content/presentation-modules";
import type { PublicProblemConfig } from "@/lib/problems/types";

export type BadgeTone =
  | "neutral"
  | "ok"
  | "err"
  | "warn"
  | "partial"
  | "info"
  | "primary";

export interface VerdictPreset {
  label: string;
  short: string;
  tone: BadgeTone;
}

export interface Presentation {

  mdxComponents?: MDXComponents;

  verdicts?: Record<string, VerdictPreset>;

  ProblemBadges?: ComponentType<{ config: PublicProblemConfig }>;
}

export const presentation: Presentation = declared;

export function describeVerdict(result: {
  outcome: string | null;
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
}): VerdictPreset {
  const label = result.outcome ?? "已评测";
  const preset = result.outcome
    ? presentation.verdicts?.[result.outcome]
    : undefined;
  if (preset) return preset;

  const tone: BadgeTone =
    result.accepted !== null
      ? result.accepted
        ? "ok"
        : "err"
      : result.score === null
        ? "neutral"
        : result.maxScore !== null && result.score >= result.maxScore
          ? "ok"
          : result.score > 0
            ? "partial"
            : "err";

  return { label, short: label, tone };
}

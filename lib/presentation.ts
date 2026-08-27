import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import { presentation as declared } from "@/content/_modules/presentation";
import type { PublicProblemConfig } from "@/lib/problems/types";
import { viewsFor } from "@/lib/problems/views";

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

/** Lookup order: problem-level verdicts → global verdicts → raw status string. */
export function describeVerdict(
  problemSlug: string | undefined,
  result: Record<string, unknown> | null,
): VerdictPreset {
  const status =
    result && typeof result.status === "string" ? result.status : null;
  const label = status ?? "已评测";

  if (status) {
    const problemVerdicts = problemSlug
      ? viewsFor(problemSlug).verdicts
      : undefined;
    const preset =
      problemVerdicts?.[status] ?? presentation.verdicts?.[status];
    if (preset) return preset;
  }

  return { label, short: label, tone: "neutral" };
}

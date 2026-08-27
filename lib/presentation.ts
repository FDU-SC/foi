import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import { presentationModules } from "@/content/presentation-modules";
import type { PublicProblemConfig } from "@/lib/problems/types";
import { loadSingletonModule, requiredExport } from "@/lib/singleton-module";

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

function buildRegistry(): Presentation {
  const found = loadSingletonModule(presentationModules, "题面组件");
  if (!found) return {};

  const exported = requiredExport(
    found,
    "presentation",
    "见 lib/presentation.ts",
  );

  if (typeof exported !== "object" || exported === null) {
    throw new Error(`${found.path} 导出的 presentation 必须是一个对象`);
  }

  return exported as Presentation;
}

export const presentation: Presentation = buildRegistry();

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

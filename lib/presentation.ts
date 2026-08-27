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

/** Lookup order: problem-level verdicts → raw status string. */
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
    const preset = problemVerdicts?.[status];
    if (preset) return preset;
  }

  return { label, short: label, tone: "neutral" };
}

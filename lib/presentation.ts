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

/** Content interprets the result; missing interpreters receive a neutral label. */
export function describeVerdict(
  problemSlug: string | undefined,
  result: unknown,
): VerdictPreset {
  const describe = problemSlug ? viewsFor(problemSlug).describeResult : undefined;
  return describe?.(result) ?? { label: "已评测", short: "已评测", tone: "neutral" };
}

import type { BadgeTone } from "@/components/ui/badge";
import { presentation } from "./registry";
import type { VerdictPreset } from "./types";

/**
 * How to render a finished submission's badge.
 *
 * Takes the resolved columns rather than the verdict, because that is where
 * the kernel's copy of these lives and because a backend may have declared a
 * pass without reporting any score at all.
 *
 * The lookup comes from `content/`; the fallback below does not, and the split
 * is the whole design. What an `accepted` status should be called in this
 * competition's language is a deployment's business. What a *number* means is
 * not: full marks is a pass, some marks is partial, no marks is a failure, and
 * a declared `accepted` outranks all three. That much the protocol already
 * fixed, so the kernel can colour any status it has never seen.
 */
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

  // An unrecognised status, so the tone has to come from the numbers. A
  // declared pass settles it; otherwise full marks reads as a pass, anything
  // above zero as partial. With no score reported there is nothing to grade
  // the colour on, which is what neutral is for.
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

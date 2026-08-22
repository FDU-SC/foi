import { Badge } from "@/components/ui/badge";
import {
  describeVerdict,
  STATE_PRESETS,
  type SubmissionState,
  type Verdict,
} from "@/lib/judge/types";

export function VerdictBadge({
  state,
  verdict,
  showScore = true,
}: {
  state: SubmissionState;
  verdict?: Verdict | null;
  showScore?: boolean;
}) {
  if (!verdict) {
    const { label, tone } = STATE_PRESETS[state];
    return (
      <Badge tone={tone}>
        {state === "judging" || state === "pending" ? (
          <span className="bg-info inline-block size-1.5 animate-pulse rounded-full" />
        ) : null}
        {label}
      </Badge>
    );
  }

  const { short, label, tone } = describeVerdict(verdict);
  const partial = verdict.score > 0 && verdict.score < verdict.maxScore;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone} title={label} mono>
        {short}
      </Badge>
      {showScore && (partial || verdict.maxScore > 1) ? (
        <span className="text-fg-muted font-mono text-xs tabular-nums">
          {verdict.score}/{verdict.maxScore}
        </span>
      ) : null}
    </span>
  );
}

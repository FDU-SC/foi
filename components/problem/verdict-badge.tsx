import { Badge } from "@/components/ui/badge";
import { STATE_PRESETS, type SubmissionState } from "@/lib/backend/types";
import { describeVerdict } from "@/lib/presentation";

/**
 * The columns this needs, so that both a database row and a `SubmissionView`
 * satisfy it. Deliberately not the verdict: a backend may report nothing but a
 * status, and these are the values the kernel resolved on arrival.
 */
export interface VerdictBadgeSubject {
  state: SubmissionState;
  outcome: string | null;
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
}

export function VerdictBadge({
  submission,
  showScore = true,
}: {
  submission: VerdictBadgeSubject;
  showScore?: boolean;
}) {
  // No status means nothing has judged this yet, or the attempt failed before
  // anything could — either way the lifecycle is all there is to show.
  if (submission.outcome === null) {
    const { label, tone } = STATE_PRESETS[submission.state];
    return (
      <Badge tone={tone}>
        {submission.state === "judging" || submission.state === "queued" ? (
          <span className="bg-info inline-block size-1.5 animate-pulse rounded-full" />
        ) : null}
        {label}
      </Badge>
    );
  }

  const { short, label, tone } = describeVerdict(submission);
  const { score, maxScore } = submission;

  // A pass/fail task reports no score, and one out of one says nothing the
  // badge has not already said.
  const scored = score !== null && maxScore !== null && maxScore > 1;
  const partial = scored && score > 0 && score < maxScore;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone} title={label} mono>
        {short}
      </Badge>
      {showScore && (partial || scored) ? (
        <span className="text-fg-muted font-mono text-xs tabular-nums">
          {score}/{maxScore}
        </span>
      ) : null}
    </span>
  );
}

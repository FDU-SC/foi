import { Badge } from "@/components/ui/badge";
import { STATE_PRESETS, type SubmissionState } from "@/lib/backend/types";
import { describeVerdict } from "@/lib/presentation";

export interface VerdictBadgeSubject {
  problemSlug: string;
  state: SubmissionState;
  result: Record<string, unknown> | null;
}

export function VerdictBadge({
  submission,
}: {
  submission: VerdictBadgeSubject;
}) {

  if (submission.result === null) {
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

  const { short, label, tone } = describeVerdict(submission.problemSlug, submission.result);

  return (
    <Badge tone={tone} title={label} mono>
      {short}
    </Badge>
  );
}

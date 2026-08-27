import type { RejudgeSkipFilter } from "@/lib/submissions/rejudge";

export function isSubmissionAccepted(
  result: Record<string, unknown> | null,
): boolean {
  return (result as { accepted?: boolean } | null)?.accepted === true;
}

export const skipAcceptedFilter: RejudgeSkipFilter = (row) =>
  row.state === "completed" && isSubmissionAccepted(row.result);

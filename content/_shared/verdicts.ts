import type { ProblemProgress, ProgressSubmission } from "@/lib/problems/views";
import type { VerdictPreset } from "@/lib/presentation";

export const verdicts: Record<string, VerdictPreset> = {
  accepted: { label: "通过", short: "AC", tone: "ok" },
  wrong_answer: { label: "答案错误", short: "WA", tone: "err" },
  time_limit_exceeded: { label: "超出时间限制", short: "TLE", tone: "warn" },
  memory_limit_exceeded: { label: "超出内存限制", short: "MLE", tone: "warn" },
  output_limit_exceeded: { label: "超出输出限制", short: "OLE", tone: "warn" },
  runtime_error: { label: "运行时错误", short: "RE", tone: "err" },
  compile_error: { label: "编译错误", short: "CE", tone: "err" },
  partial: { label: "部分正确", short: "PC", tone: "partial" },
  system_error: { label: "系统错误", short: "SE", tone: "err" },
};

export const ACCEPTED_FIELD = "accepted";
export const ACCEPTED_VALUE = true;

/** This template uses a boolean accepted field; other result formats supply their own adapter. */
export function isAcceptedResult(result: unknown): boolean {
  return (
    typeof result === "object" && result !== null &&
    ACCEPTED_FIELD in result && result[ACCEPTED_FIELD] === ACCEPTED_VALUE
  );
}

export function describeResult(result: unknown): VerdictPreset {
  const status = typeof result === "object" && result !== null &&
    "status" in result && typeof result.status === "string" ? result.status : null;
  const label = status ?? "已评测";
  return status && Object.hasOwn(verdicts, status)
    ? verdicts[status]
    : { label, short: label, tone: "neutral" };
}

export function progress(history: readonly ProgressSubmission[]): ProblemProgress {
  if (history.length === 0) return { state: "untouched", verdict: null };
  if (history.some((row) => row.state === "completed" && isAcceptedResult(row.result))) {
    return { state: "solved", verdict: verdicts.accepted };
  }
  const latest = history.reduce((a, b) => (
    +a.createdAt > +b.createdAt || (+a.createdAt === +b.createdAt && a.id > b.id)
  ) ? a : b);
  return {
    state: "attempted",
    verdict: latest.result == null ? null : describeResult(latest.result),
  };
}

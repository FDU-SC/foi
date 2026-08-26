import type { VerdictPreset } from "@/lib/presentation";

/**
 * What this deployment calls the verdict statuses its backends report.
 *
 * A lookup, not a whitelist. `verdictSchema` takes any status a backend cares
 * to send and the kernel stores it verbatim; anything missing from this table
 * renders as itself with a colour derived from the score. So adding a status
 * to a backend needs no change here, and a line here is only worth adding when
 * the raw string is not what a competitor should read.
 *
 * `system_error` is here as a rendering fallback for rows written before the
 * pull model, and for a backend that insists on reporting one. It is not how
 * an internal failure should be reported: `state: "failed"` is, and it is the
 * only one of the two that keeps the submission out of the standings.
 */
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

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

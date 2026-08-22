import { z } from "zod";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Lifecycle of a submission as tracked by the kernel. Distinct from the
 * judge's own verdict status, which is an opaque string.
 */
export const SUBMISSION_STATES = [
  "pending",
  "judging",
  "completed",
  "failed",
] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export function isTerminalState(state: SubmissionState): boolean {
  return state === "completed" || state === "failed";
}

/**
 * The kernel's entire understanding of a judge result.
 *
 * `status` and `score` exist so generic UI (submission lists, standings) can
 * work without knowing anything about the problem. `detail` is deliberately
 * opaque: only problem-specific components and rulesets ever interpret it.
 */
export const verdictSchema = z.object({
  status: z.string().min(1).max(64),
  score: z.number().finite(),
  maxScore: z.number().finite().positive(),
  detail: z.unknown().optional(),
});

export type Verdict = z.infer<typeof verdictSchema>;

/** Request body the kernel POSTs to a judge endpoint. */
export interface JudgeRequest {
  submissionId: string;
  problem: { slug: string; config: unknown };
  payload: unknown;
  callbackUrl: string;
  callbackToken: string;
}

/** Body a judge PUTs back once it has finished. */
export const judgeCallbackSchema = verdictSchema.extend({
  submissionId: z.string().min(1),
  callbackToken: z.string().min(1),
});

export type JudgeCallback = z.infer<typeof judgeCallbackSchema>;

/** Shape returned when the kernel polls a judge for a stale submission. */
export const judgeStatusSchema = z.object({
  done: z.boolean(),
  verdict: verdictSchema.optional(),
});

/**
 * Queueing is the judge's responsibility, not the kernel's.
 *
 * FOI dispatches immediately and never holds submissions back, so a judge must
 * accept every request and queue internally rather than blocking or rejecting
 * when busy. `GET /queue` is how it reports that queue, and is a required part
 * of the judge protocol.
 */
export const QUEUE_HEALTH = ["ok", "busy", "draining", "error"] as const;
export type QueueHealth = (typeof QUEUE_HEALTH)[number];

export const queueItemSchema = z.object({
  submissionId: z.string().min(1),
  /**
   * Judges are expected to report this, but it is optional here because FOI
   * strips it before serving the queue to non-admins: it would reveal which
   * problem each player is working on.
   */
  problemSlug: z.string().min(1).optional(),
  state: z.enum(["pending", "running"]),
  enqueuedAt: z.string(),
  startedAt: z.string().optional(),
});

export type QueueItem = z.infer<typeof queueItemSchema>;

export const judgeQueueSchema = z.object({
  health: z.enum(QUEUE_HEALTH),
  /** Number of submissions the judge can evaluate concurrently. */
  capacity: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  /** Submissions finished since the judge started, for a throughput read. */
  completed: z.number().int().nonnegative().optional(),
  /** Mean wall time per evaluation so far, in milliseconds. */
  avgDurationMs: z.number().nonnegative().optional(),
  /** Optional detail; judges may cap or omit this list. */
  items: z.array(queueItemSchema).default([]),
  version: z.string().optional(),
  uptimeMs: z.number().nonnegative().optional(),
});

export type JudgeQueue = z.infer<typeof judgeQueueSchema>;

export const QUEUE_HEALTH_PRESETS: Record<
  QueueHealth,
  { label: string; tone: BadgeTone }
> = {
  ok: { label: "空闲", tone: "ok" },
  busy: { label: "繁忙", tone: "warn" },
  draining: { label: "停止接单", tone: "info" },
  error: { label: "异常", tone: "err" },
};

interface VerdictPreset {
  label: string;
  short: string;
  tone: BadgeTone;
}

/**
 * Display metadata for verdict statuses FOI ships with. Judges are free to
 * return anything else; `describeVerdict` falls back to scoring the result.
 */
export const VERDICT_PRESETS: Record<string, VerdictPreset> = {
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

export function describeVerdict(verdict: Verdict): VerdictPreset {
  const preset = VERDICT_PRESETS[verdict.status];
  if (preset) return preset;

  // Unknown status from a custom judge: derive a tone from the score so the
  // generic UI still reads correctly.
  const tone: BadgeTone =
    verdict.score >= verdict.maxScore
      ? "ok"
      : verdict.score > 0
        ? "partial"
        : "err";

  return { label: verdict.status, short: verdict.status, tone };
}

export const STATE_PRESETS: Record<
  SubmissionState,
  { label: string; tone: BadgeTone }
> = {
  pending: { label: "排队中", tone: "info" },
  judging: { label: "评测中", tone: "info" },
  completed: { label: "已完成", tone: "neutral" },
  failed: { label: "评测失败", tone: "err" },
};

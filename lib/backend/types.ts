import { z } from "zod";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Lifecycle of a submission as tracked by the kernel. Distinct from the
 * judge's own verdict status, which is an opaque string.
 *
 * `failed` and `abandoned` are both "no verdict, and none is coming", and they
 * are two states because they are two different claims. `failed` is a backend
 * saying no — a 4xx on dispatch, or `accepted: false` — which is a decision
 * somebody made about this submission. `abandoned` is the reconciler guessing:
 * nothing has come back for long enough that the kernel stops waiting. A guess
 * can be wrong, so the write path treats them oppositely — see
 * `acceptsVerdict`. Players are shown the same thing either way; the
 * distinction answers a question only the callback handler asks.
 */
export const SUBMISSION_STATES = [
  "pending",
  "judging",
  "completed",
  "failed",
  "abandoned",
] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];

/**
 * "Is there any point waiting for this?" — the client's question.
 *
 * Everything that polls, streams or renders a spinner asks this one: whether
 * to keep an EventSource open, whether to schedule another poll, whether to
 * look the row up in a judge's queue. `abandoned` is settled because the
 * kernel has stopped expecting a result, and a client that kept waiting would
 * wait on a row nothing is going to touch.
 */
export function isSettled(state: SubmissionState): boolean {
  return (
    state === "completed" || state === "failed" || state === "abandoned"
  );
}

/**
 * "May a callback still write to this?" — the server's question.
 *
 * Not the negation of `isSettled`, and that is the whole reason there are two
 * predicates rather than one. `abandoned` answers yes to both: the client
 * should stop waiting, *and* a late callback is still welcome, because
 * abandonment was a guess about a backend that had gone quiet and a verdict
 * arriving afterwards proves the guess wrong. Collapsing the two back into a
 * single "terminal" would force a choice between clients spinning forever on
 * abandoned rows and real verdicts being discarded on arrival.
 *
 * `completed` and `failed` are excluded for the usual idempotency reason:
 * whichever verdict landed first is the one that counts, and `failed` is a
 * refusal the backend itself issued rather than something the kernel inferred.
 */
export function acceptsVerdict(state: SubmissionState): boolean {
  return state === "pending" || state === "judging" || state === "abandoned";
}

/**
 * The states a submission can still be moved out of *by the reconciler*.
 *
 * Every write that reaches a terminal state is guarded by this list in its
 * `where` clause rather than by a preceding read. The callback handler and the
 * reconciler can both be holding a row that was non-terminal a moment ago —
 * the reconciler in particular holds one across a network call to the judge —
 * so whichever writes second has to lose rather than overwrite a verdict that
 * already landed. Without the guard an accepted submission can be rewritten as
 * a timeout, silently and after the fact.
 *
 * Deliberately narrower than `acceptsVerdict`: `abandoned` is absent. The
 * sweep selects on this list too, and a row it has already given up on should
 * not come back round every fifteen seconds to be polled and given up on
 * again. A verdict may still land on it — but by callback, which is the
 * channel that has something new to say.
 */
export const NON_TERMINAL_STATES: SubmissionState[] = ["pending", "judging"];

/** The states a callback may still write over. See `acceptsVerdict`. */
export const CALLBACK_WRITABLE_STATES: SubmissionState[] =
  SUBMISSION_STATES.filter(acceptsVerdict);

/**
 * What a backend may say when it has finished.
 *
 * Only `status` is required, and only because a submission list has to put
 * *something* in the badge column. Everything else is optional because problem
 * types vary more than any fixed shape can anticipate, and a backend should
 * not have to invent a number to satisfy a schema:
 *
 *   score      omit for a task that is pass/fail rather than scored.
 *   maxScore   omit and the problem's configured `maxScore` is the
 *              denominator. Declare one for a task whose total is computed —
 *              a performance problem scoring against a measured baseline.
 *   accepted   omit and `score >= maxScore` decides. Declare one where full
 *              marks and passing are different questions, which is the case
 *              the derivation gets wrong.
 *   detail     deliberately opaque; only a problem's own components and
 *              rulesets ever interpret it.
 *
 * The kernel reads these four exactly once, in the callback handler, and keeps
 * what it needs in columns on the submission. Nothing downstream reaches into
 * a verdict — see the note on `verdict` in `lib/db/schema.ts`.
 */
export const verdictSchema = z.object({
  status: z.string().min(1).max(64),
  score: z.number().finite().optional(),
  maxScore: z.number().finite().positive().optional(),
  accepted: z.boolean().optional(),
  detail: z.unknown().optional(),
});

export type Verdict = z.infer<typeof verdictSchema>;

/**
 * Who a backend is being asked to act for.
 *
 * In the body rather than in a header because `sign()` covers the timestamp,
 * the method, the path and the body — and no headers at all. An identity in a
 * header is an identity the signature does not protect, which is worse than
 * none at all since the backend would have every reason to trust it.
 *
 * `handle` is the identity: there is no opaque id anywhere in this codebase,
 * and submissions are keyed by handle too, so a backend comparing the two
 * needs no lookup table. `groups` rides along because a backend may want to
 * give setters a longer lease or a larger quota without the kernel having to
 * learn what a lease is.
 */
export interface BackendUser {
  handle: string;
  groups: readonly string[];
}

/**
 * Request body the kernel POSTs to a judge endpoint.
 *
 * `user` is here for problems whose answer differs per person. A container
 * handed out by `spawn` carries a flag only its creator should be able to
 * redeem, and the backend can only enforce that if it knows who submitted —
 * otherwise the first person to solve it can post the flag in a group chat.
 */
export interface JudgeRequest {
  submissionId: string;
  user: BackendUser;
  problem: { slug: string; config: unknown };
  contestSlug: string | null;
  payload: unknown;
  callbackUrl: string;
  callbackToken: string;
}

/**
 * Request body the kernel POSTs to an interactive endpoint.
 *
 * Deliberately the same shape as `JudgeRequest` minus the parts that only
 * judging needs. The kernel reads `action` to pick the path and nothing else:
 * `payload` and the response are as opaque here as a verdict's `detail` is
 * everywhere else.
 */
export interface BackendActionRequest {
  action: string;
  user: BackendUser;
  problem: { slug: string; config: unknown };
  contestSlug: string | null;
  payload: unknown;
}

/**
 * What a backend says about itself when it reports.
 *
 * Required, unlike everything optional in a verdict, and the difference is not
 * strictness for its own sake. `score`, `maxScore` and `accepted` may be
 * omitted because they can genuinely not exist — a pass/fail task has no score,
 * a computed total has no fixed maximum. A running process always has a
 * version, even if it is `dev` or a commit hash, so making this optional would
 * only blur "this backend never reports one" into "this judging did not record
 * one", and a provenance trail with holes in it is not a provenance trail.
 *
 * It rides on the envelope rather than inside the verdict because it answers
 * "who judged this", not "what did it decide" — the same layer as
 * `submissionId` and `callbackToken`. That also keeps it out of the archived
 * verdict blob, and lets `/status/<ref>` report a version while `done` is still
 * false and there is no verdict to attach it to.
 *
 * Self-reported and unverifiable, but it travels inside the HMAC-signed body,
 * so it is at least the backend's own claim rather than a third party's — the
 * same standing `status` has.
 */
const backendVersionSchema = z.string().min(1).max(64);

/** Body a judge PUTs back once it has finished. */
export const judgeCallbackSchema = verdictSchema.extend({
  submissionId: z.string().min(1),
  callbackToken: z.string().min(1),
  backendVersion: backendVersionSchema,
});

export type JudgeCallback = z.infer<typeof judgeCallbackSchema>;

/** Shape returned when the kernel polls a judge for a stale submission. */
export const judgeStatusSchema = z.object({
  done: z.boolean(),
  verdict: verdictSchema.optional(),
  backendVersion: backendVersionSchema,
});

export type JudgeStatus = z.infer<typeof judgeStatusSchema>;

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

/**
 * How to render a finished submission's badge.
 *
 * Takes the resolved columns rather than the verdict, because that is where
 * the kernel's copy of these lives now and because a backend may have declared
 * a pass without reporting any score at all.
 */
export function describeVerdict(result: {
  outcome: string | null;
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
}): VerdictPreset {
  const label = result.outcome ?? "已评测";
  const preset = result.outcome ? VERDICT_PRESETS[result.outcome] : undefined;
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

/**
 * `abandoned` reads as `failed` on purpose, down to the wording.
 *
 * Whether the kernel was told the submission would never be judged or merely
 * concluded as much is a question about the write path — it decides what a
 * late callback is allowed to do. The player asked a different question, "do I
 * have a result", and the answer is no either way. Two labels here would
 * publish an internal distinction as if it were something to act on. What does
 * differ is the reason text on the row, which `toView` surfaces for both.
 */
export const STATE_PRESETS: Record<
  SubmissionState,
  { label: string; tone: BadgeTone }
> = {
  pending: { label: "排队中", tone: "info" },
  judging: { label: "评测中", tone: "info" },
  completed: { label: "已完成", tone: "neutral" },
  failed: { label: "评测失败", tone: "err" },
  abandoned: { label: "评测失败", tone: "err" },
};

/**
 * What to say when nothing more specific was recorded.
 *
 * These are the only two sentences that tell `failed` and `abandoned` apart in
 * front of a player, and they are worth telling apart because they call for
 * opposite reactions: a refusal means the submission itself was unacceptable
 * and resubmitting the same thing will be refused again, while a timeout says
 * nothing about the submission at all and is worth retrying.
 */
const DEFAULT_FAILURE_REASONS: Record<"failed" | "abandoned", string> = {
  failed: "题目后端拒绝了这次提交",
  abandoned: "评测超时，未收到题目后端结果",
};

/**
 * Why there is no verdict, or null when that is not the question.
 *
 * Gated on the state rather than simply exposing the `error` column, because
 * that column is also written on a dispatch whose outcome was *unknown* — a
 * row that is still `pending` and may yet be judged. Showing "无法连接题目后端"
 * next to a spinner would announce a failure that has not happened.
 *
 * The row's own text wins where there is one: it names the status code or the
 * refusal the backend gave, which is more use to whoever has to fix it than
 * either sentence above.
 */
export function failureReason(submission: {
  state: SubmissionState;
  error: string | null;
}): string | null {
  if (submission.state !== "failed" && submission.state !== "abandoned") {
    return null;
  }
  return submission.error ?? DEFAULT_FAILURE_REASONS[submission.state];
}

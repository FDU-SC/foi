import { z } from "zod";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * `submissions.backendId` for a problem the kernel judged itself.
 *
 * The column is `not null` because every other row has a real backend to name,
 * and a sentinel keeps it that way rather than making every reader handle a
 * null. Safe as a value because `backends.config.ts` keys double as
 * environment-variable fragments: a real entry by this name would need
 * `FOI_BACKEND_INLINE_SECRET`, which nothing sets.
 *
 * Rows carrying it are written to a terminal state in the same request that
 * created them, so no runner ever sees one — `claimJob` selects by backend id
 * and nothing signs as `inline`.
 */
export const INLINE_BACKEND_ID = "inline";

/** `submissions.backendVersion` for an inline judgement. */
export const INLINE_BACKEND_VERSION = "inline";

/**
 * The lifecycle of a submission, and the whole of what the kernel understands
 * about judging.
 *
 * Four states, because each one corresponds to a decision the kernel makes on
 * its own account:
 *
 *   queued     nobody is holding it — the queue fuse applies
 *   judging    somebody is holding it and is still alive — the heartbeat rule
 *              applies
 *   completed  there is a verdict
 *   disrupted  there is no verdict and there will not be one, **and it is not
 *              the submitter's fault**
 *
 * There is deliberately no "claimed but not started yet". What the kernel needs
 * to know is that somebody holds this and is alive; whether that somebody is
 * cloning a repository, pulling an image or running the seventh test is a thing
 * it has no business having an opinion about. GitLab's `waiting_for_runner_ack`
 * exists because they had no uniform heartbeat at the time; we do, so the
 * premise does not hold.
 *
 * `disrupted` is the Internal Error every mainstream judge has, and it covers
 * two sources at once: a runner saying "I cannot evaluate this", and the kernel
 * inferring that nobody is coming. They are one state because the handling is
 * identical — no result, not counted against the submitter, an administrator
 * can rejudge — and the difference is recorded in `error` rather than in the
 * state. DOMjudge is the sharpest precedent: internal error is not in its
 * verdict priority table at all, because it is not a verdict, it is a veto
 * saying "this judging does not count".
 *
 * `rejected` used to be here and is gone with the push model. Its three sources
 * were a 4xx on dispatch, an `accepted: false` acknowledgement, and an inline
 * judge throwing. The first two do not exist when nobody dispatches, and the
 * third was always misfiled: our code breaking is not the submission being
 * unacceptable, so it lands in `disrupted` too.
 *
 * A union rather than a `const` array indexed into. The array was exported and
 * nothing imported it: no caller iterates the states, and the two places that
 * enumerate them — `STATE_PRESETS` below and the state column's `$type` — are
 * both keyed by the type, so a missing case is a compile error either way.
 * What the value bought was a runtime list nobody asked for.
 */
export type SubmissionState = "queued" | "judging" | "completed" | "disrupted";

/**
 * "Is there any point waiting for this?" — the client's question.
 *
 * Everything that polls, streams or renders a spinner asks this one. There used
 * to be a second predicate beside it answering "may a late report still write
 * here", because the push model had a state — `abandoned` — that was settled
 * for the reader and still writable by the judge. A lease removes the need: a
 * report is accepted when it holds the current lease and refused when it does
 * not, which is a fact about the holder rather than a guess about the state.
 */
export function isSettled(state: SubmissionState): boolean {
  return state === "completed" || state === "disrupted";
}

/** Nobody has finished with this row yet. */
export const NON_TERMINAL_STATES: SubmissionState[] = ["queued", "judging"];

/** The rows a rejudge may pick up. */
export const TERMINAL_STATES: SubmissionState[] = ["completed", "disrupted"];

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
 * **Nothing here says "the judging itself broke".** That is a state, not a
 * verdict — a runner that cannot evaluate reports `state: "failed"` and the row
 * lands in `disrupted`. Adding a field for it would make the kernel read
 * meaning out of a status string, and would put blame for a machine fault
 * inside the object that records what the submission scored.
 *
 * The kernel reads these four exactly once, in `reportDone`, and keeps what it
 * needs in columns on the submission. Nothing downstream reaches into a
 * verdict — see the note on `verdict` in `lib/db/schema.ts`.
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
 * Request body the kernel POSTs to an interactive endpoint.
 *
 * The one thing the kernel still initiates against a backend, and the reason
 * `leaky-bucket` keeps an inbound address while the other three no longer need
 * one: `spawn`/`poll`/`destroy` are synchronous requests a player set off, and
 * there is no way to pull those. That is not a compromise — a player who is
 * going to connect into a container needs that machine reachable anyway.
 *
 * The kernel reads `action` to pick the path and nothing else: `payload` and
 * the response are as opaque here as a verdict's `detail` is everywhere else.
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
 * On the envelope rather than inside the verdict because it answers "who judged
 * this", not "what did it decide" — which is also why a `failed` report carries
 * one: there is no verdict there to attach it to, and knowing which version of
 * a runner could not evaluate something is the first thing anybody asks.
 *
 * Self-reported and unverifiable, but it travels inside the HMAC-signed body,
 * so it is at least the backend's own claim rather than a third party's — the
 * same standing `status` has.
 */
const backendVersionSchema = z.string().min(1).max(64);

/**
 * A runner's opaque account of what it is doing, carried on a heartbeat.
 *
 * "拉取镜像", "测试点 3/10", "等待对手 bot" are all legal values. The kernel
 * stores it, hands it to the browser and interprets not one character of it —
 * the same treatment `verdict.detail` gets, and for the same reason. There is
 * deliberately no separate notion of *progress*: a workflow problem with five
 * phases cannot be described by a fraction, and any fixed vocabulary the kernel
 * imposed here would be wrong for some problem it has not seen yet.
 *
 * Bounded only because it is a string arriving over the network that ends up in
 * a column and on a page.
 */
const runnerStatusSchema = z.string().min(1).max(200);

/**
 * Body a runner POSTs to ask for work.
 *
 * `backendId` says which queue, and the signature has to verify against *that*
 * backend's key — holding one backend's secret gets you that backend's work and
 * nothing else. Naming it explicitly rather than inferring it from whichever
 * configured key happens to verify: keys are allowed to be equal (several
 * entries can be one runner deployment), and an inference that is ambiguous
 * exactly when a deployment is under-configured is the wrong place to be clever.
 *
 * `runnerId` is self-reported and unverified. It exists so an operator can tell
 * two machines apart on the board, not to authorise anything — authorisation is
 * the signature, and the holder check on a job is the lease.
 *
 * `nonce` is what makes one signature good for one claim. Everything else here
 * is near enough constant — a runner sends the same two fields to the same
 * constant path every second — so without it the signing input repeats and a
 * captured pair of headers could be posted again for the whole of the
 * timestamp window, taking a job each time. The other two runner endpoints
 * need nothing like it: they name an id and a lease, and the lease is spent by
 * the first request that lands. Any fresh random string does; the bounds are
 * wide enough for a UUID and tight enough that the value has to carry real
 * entropy. See `lib/runner/replay.ts`.
 */
export const jobRequestSchema = z.object({
  backendId: z.string().min(1).max(64),
  runnerId: z.string().min(1).max(64),
  nonce: z.string().min(16).max(64),
});

/**
 * What a claim answers with.
 *
 * An id and a lease, and it will never need to be anything else. Everything a
 * runner has to know in order to evaluate is behind the details endpoint, so a
 * new field is added there rather than here — and a runner that prefetches
 * claims N of these, fetches N sets of details and starts work, with the
 * protocol needing nothing to express that.
 */
export interface JobTicket {
  id: string;
  lease: string;
}

/** Everything a runner needs in order to evaluate one submission. */
export interface JobDetails {
  id: string;
  user: BackendUser;
  problem: { slug: string; config: unknown };
  contestSlug: string | null;
  payload: unknown;
}

/**
 * The three things a runner can say about a job it holds.
 *
 * One endpoint and one discriminant rather than three routes, because all three
 * are the same act — the holder of a lease reporting on it — and the lease check
 * is the same in each. `alive` is what stops the reaper taking the job back;
 * `done` and `failed` are the two ways to give it up.
 *
 * `reason` on `failed` is prose for an operator and for the row's `error`. It is
 * not a verdict and is never scored: the whole point of reporting `failed`
 * rather than a `system_error` verdict is that the kernel records "no result"
 * instead of "the submitter got zero".
 */
export const jobReportSchema = z.discriminatedUnion("state", [
  z.object({
    lease: z.string().min(1).max(128),
    state: z.literal("alive"),
    status: runnerStatusSchema.optional(),
  }),
  z.object({
    lease: z.string().min(1).max(128),
    state: z.literal("done"),
    verdict: verdictSchema,
    backendVersion: backendVersionSchema,
  }),
  z.object({
    lease: z.string().min(1).max(128),
    state: z.literal("failed"),
    reason: z.string().min(1).max(500),
    backendVersion: backendVersionSchema,
  }),
]);

export type JobReport = z.infer<typeof jobReportSchema>;

interface VerdictPreset {
  label: string;
  short: string;
  tone: BadgeTone;
}

/**
 * Display metadata for verdict statuses FOI ships with. Judges are free to
 * return anything else; `describeVerdict` falls back to scoring the result.
 *
 * `system_error` stays as a rendering fallback for rows written before the pull
 * model, and for a backend that insists on reporting one. It is not how an
 * internal failure should be reported: `state: "failed"` is, and it is the only
 * one of the two that keeps the submission out of the standings.
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
 * `disrupted` is not spelled as a failure, and that is the point of it being a
 * state of its own.
 *
 * It used to read "评测失败" in red, alongside a genuine refusal of the
 * submission, which told a player their work was rejected when what happened is
 * that a machine fell over. Every mainstream judge is explicit about this —
 * PEGWiki's wording for IE is literally "it is not your fault, an administrator
 * will rejudge your submission" — so the label says the judging was
 * interrupted, and the tone is a warning rather than an error, because the red
 * one is reserved for outcomes the submitter can act on.
 */
export const STATE_PRESETS: Record<
  SubmissionState,
  { label: string; tone: BadgeTone }
> = {
  queued: { label: "排队中", tone: "info" },
  judging: { label: "评测中", tone: "info" },
  completed: { label: "已完成", tone: "neutral" },
  disrupted: { label: "评测中断", tone: "warn" },
};

/**
 * What to say when nothing more specific was recorded.
 *
 * One sentence where there used to be two, because there is now one state. The
 * pair existed to tell a refusal apart from a timeout, which called for
 * opposite reactions from the player; neither survives — a refusal cannot
 * happen when nothing is dispatched, and a machine going quiet is not something
 * the player can respond to at all. So the sentence says what is true and what
 * to do about it, which is: nothing, ask for a rejudge.
 */
const DEFAULT_DISRUPTED_REASON =
  "评测未能完成，这不是你这次提交的问题。请联系管理员重判。";

/**
 * Why there is no verdict, or null when that is not the question.
 *
 * Gated on the state rather than simply exposing the `error` column, because
 * that column also carries text on rows that are still in flight — a runner's
 * last words before it was taken off a job, for instance. Showing those next to
 * a spinner would announce a failure that has not happened.
 *
 * The row's own text wins where there is one: it names what the runner said, or
 * which of the kernel's two conclusions was drawn, and that is more use to
 * whoever has to fix it than the sentence above.
 */
export function failureReason(submission: {
  state: SubmissionState;
  error: string | null;
}): string | null {
  if (submission.state !== "disrupted") return null;
  return submission.error ?? DEFAULT_DISRUPTED_REASON;
}

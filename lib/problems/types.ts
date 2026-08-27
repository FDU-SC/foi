import { z } from "zod";
import { audienceSchema } from "@/lib/permissions/audience";
import { SLUG_PATTERN } from "@/lib/utils";
// Types only: `PublicProblemConfig` is handed to client components, so nothing
// here may pull a runtime dependency on the backend layer into a browser chunk.
import type { BackendUser, Verdict } from "@/lib/backend/types";

/**
 * How often one person may invoke one action.
 *
 * Per action rather than per problem or per backend, because the costs are not
 * comparable: starting a container is expensive and asking whether it is ready
 * is not, and a shared window means the polling drains the budget the spawn
 * needed. Left off, `DEFAULT_ACTION_RATE_LIMIT` applies.
 *
 * Exported because a contest reuses the shape to override a problem's submit
 * throttle; see `contestProblemSchema` in `lib/contests/types.ts`.
 */
export const actionRateLimitSchema = z.object({
  max: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});

export type ActionRateLimit = z.infer<typeof actionRateLimitSchema>;

/** Applied to any action that does not name its own. */
export const DEFAULT_ACTION_RATE_LIMIT: ActionRateLimit = {
  max: 10,
  windowSeconds: 60,
};

/**
 * Applied to a problem that does not name its own submit throttle, and to
 * every submission made outside a contest.
 *
 * The kernel owns the vocabulary and a floor, not the number a round wants —
 * how often a competitor may submit is a decision about how the competition
 * runs, and a deployment states it in `content/`. What is left here is a
 * default chosen to be invisible: twenty a minute is far more than anybody
 * types by hand, so a problem that says nothing behaves as if there were no
 * throttle while still not being unbounded.
 *
 * The separate cap in `app/api/submissions/route.ts` is a different thing and
 * deliberately not configurable — see the note there.
 */
export const DEFAULT_SUBMIT_RATE_LIMIT: ActionRateLimit = {
  max: 20,
  windowSeconds: 60,
};

/**
 * An inline judge's way of saying there is not going to be a result.
 *
 * The equivalent of a runner reporting `state: "failed"`: the row lands in
 * `disrupted` and nothing is scored against anybody. `Verdict` deliberately
 * cannot express it — see `verdictSchema` in `lib/backend/types.ts`.
 *
 * Returning `status: "system_error"` instead is the trap. It renders as a
 * fault, which is why it looks like the right answer, but it is still a
 * verdict: the row lands in `completed`, `scoredSubmissions` counts it, it
 * shows on the board, and any format that charges for a rejected attempt
 * charges for this one — so a setter's missing config key bills the next
 * person to submit.
 *
 * `reason` is prose for whoever opens the submission, and lands in
 * `submissions.error` exactly where a runner's would.
 */
export interface InlineUnavailable {
  unavailable: true;
  reason: string;
}

/** What an inline judge decided: a result, or that there cannot be one. */
export type InlineJudgement = Verdict | InlineUnavailable;

/**
 * Which half of the judgement this is.
 *
 * A predicate for the same reason `isInlineBackend` below is one: the
 * discriminant is a key `Verdict` merely happens not to have, and a call site
 * that spells the check itself is a call site that can get it subtly wrong.
 */
export function isInlineUnavailable(
  judgement: InlineJudgement,
): judgement is InlineUnavailable {
  return "unavailable" in judgement;
}

/**
 * A judgement the kernel reaches by itself, with no backend involved.
 *
 * Synchronous on purpose, and that is the one part of the bargain the type
 * system can hold: an inline judge cannot await, so it cannot reach the
 * network or the database. What no type can hold is that the work stays
 * small — synchronous JavaScript cannot be preempted, so a judge that loops
 * takes the whole process with it. Comparisons, lookups, a bounded simulation
 * over a size the config already capped: anything that genuinely computes
 * belongs on a backend.
 *
 * **Never inline a judgement that executes what the competitor submitted.**
 * Isolation is the entire reason external backends exist, and there is no
 * amount of "it is only a small script" that makes running one here safe.
 *
 * Returns an `InlineJudgement` rather than a `Verdict`, so that a judge which
 * cannot judge can say so instead of inventing a score; the argument is on
 * `InlineUnavailable`.
 */
export type InlineJudge = (input: {
  payload: unknown;
  config: unknown;
  user: BackendUser;
  contestSlug: string | null;
}) => InlineJudgement;

/**
 * Judged here, in this process, at submit time.
 *
 * The test for whether a problem belongs on this side is whether everything
 * the judgement needs is already in the kernel's hands: the submission, the
 * problem's config, who submitted, and the kernel's own secrets. A per-player
 * answer is still inline when it can be *derived* — `HMAC(secret, slug|handle)`
 * needs no state and cannot be predicted by the player. What pushes a problem
 * out is needing isolation (running submitted code), resources (a time or
 * memory limit worth measuring), or state the kernel does not hold (a
 * container, a flag minted at spawn).
 *
 * There are no `actions`: an inline judge has no service behind it to relay to.
 */
const inlineBackendSchema = z.strictObject({
  kind: z.literal("inline"),
  config: z.unknown().optional(),

  /**
   * Rejecting `async` here is not pedantry about the declared type.
   *
   * `z.custom` is the only check this field gets, and a bare
   * `typeof value === "function"` passes an `async` judge that returns a
   * Promise. The submit route then writes that Promise into the `verdict`
   * jsonb column, where it serialises as `{}`, and reads four nulls back out
   * of it. Nothing throws, the row settles as `completed`, and the only
   * evidence is a submission whose verdict is empty.
   *
   * It catches the declaration rather than every way to hand back a Promise —
   * a plain function whose body returns one still gets through. That is the
   * shape the mistake actually takes, and the alternative, inspecting what the
   * judge returned, cannot happen until it has already been called.
   */
  judge: z.custom<InlineJudge>(
    (value) =>
      typeof value === "function" && value.constructor.name !== "AsyncFunction",
    { message: "内联判题的 judge 必须是一个同步函数" },
  ),
});

/**
 * Which backend serves this problem and what to hand it. `config` is passed
 * through verbatim; the kernel never looks inside.
 *
 * `actions` opens interactive endpoints on that backend to players who can
 * already see the problem. Each key is forwarded as `POST /action/<key>` and
 * is never interpreted here — spawning a container and asking whether it is
 * ready are the same thing to the kernel, a declared string it may relay.
 *
 * Declared per problem rather than per backend because it is the problem
 * that decides what its statement offers, and an undeclared key is a 404
 * rather than a forwarded request: without the list, `[...path]` would relay
 * anything, including `/judge` and `/status`.
 */
const externalBackendSchema = z.strictObject({
  id: z.string().min(1),
  config: z.unknown().optional(),
  actions: z
    .record(
      z.string().regex(/^[a-z0-9-]+$/, "action 名只能包含小写字母、数字和连字符"),
      z.object({ rateLimit: actionRateLimitSchema.optional() }).default({}),
    )
    .default({}),
});

export type InlineBackend = z.infer<typeof inlineBackendSchema>;
export type ExternalBackend = z.infer<typeof externalBackendSchema>;

/**
 * Which half of the union this is.
 *
 * A predicate rather than a bare `"kind" in backend` at each call site, so
 * that adding a third way to judge — if there ever is one — is a change to
 * this file instead of a search for every place that guessed.
 */
export function isInlineBackend(
  backend: InlineBackend | ExternalBackend,
): backend is InlineBackend {
  return "kind" in backend && backend.kind === "inline";
}

/**
 * Everything FOI needs to know about a problem. Authored as a TypeScript
 * module in `content/problems/<slug>/problem.ts` so mistakes surface as type
 * errors, and validated at load time so they also surface as clear runtime
 * errors when the shape drifts.
 */
export const problemConfigSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(SLUG_PATTERN, "slug 只能包含小写字母、数字和连字符"),
  title: z.string().min(1),
  maxScore: z.number().positive().default(100),

  /**
   * How this problem is judged: in the kernel, or by a backend.
   *
   * Both halves keep `config` opaque — the kernel never looks inside it, and
   * an inline judge is the problem's own function reading the problem's own
   * configuration. That the two are the same shape is the point: `backend.id`
   * and `backend.judge` are both pointers the kernel relays to without
   * understanding, one to a URL and one to a function.
   *
   * Both members are strict, and that matters more here than it usually does.
   * TypeScript's excess-property check against a union accepts any key that
   * appears in *some* member, so `{ kind, judge, id }` type-checks — and Zod
   * would then match the inline half and silently drop the `id`, leaving a
   * problem that reads as though it dispatches while judging locally. Strict
   * turns that into a load-time error naming the stray key.
   */
  backend: z.union([inlineBackendSchema, externalBackendSchema]),

  /**
   * What submitting to this problem costs the deployment. Nothing about what
   * it looks like — anything describing the submitter widget is a fact about
   * a template and belongs in `ui`.
   */
  submit: z
    .object({
      /**
       * How often one person may submit to this problem. Omitted means
       * `DEFAULT_SUBMIT_RATE_LIMIT`; a contest may override it for its own
       * round without touching the problem.
       *
       * Here rather than in the route because it is the same kind of decision
       * as `backend.actions[…].rateLimit` right above: what this problem costs
       * to run is the problem's to state.
       */
      rateLimit: actionRateLimitSchema.optional(),
    })
    .default({}),

  /**
   * Whatever this deployment's statement components need, uninterpreted.
   *
   * The third opaque field, and deliberately the same bargain as
   * `backend.config` and `verdict.detail`: the kernel carries it from the
   * problem file to `useProblem()` and never looks inside. Everything a
   * deployment's own taxonomy needs — tags, difficulty, whatever the submitter
   * widget takes — goes here, so that describing it differently is a
   * `content/` edit rather than a schema change, and it is drawn through
   * `Presentation.ProblemBadges`.
   *
   * Reaches the browser, unlike `backend.config` — `toPublicConfig` strips
   * that one and not this one. Nothing secret goes here.
   */
  ui: z.unknown().optional(),

  /**
   * Which groups may see this problem. Omitted means everyone, `[]` means
   * nobody — that is how a problem is staged before it has an audience.
   *
   * Composes with the contest gate rather than replacing it: a problem for the
   * school team that belongs to next week's round is visible to neither until
   * both say yes.
   */
  visibleTo: audienceSchema,

  /**
   * Whether this problem has been taken out of service.
   *
   * Deliberately *not* a second way to spell `visibleTo: []`. It answers a
   * different question — not "who may read this" but "may anything new be sent
   * to it" — and the two axes cross:
   *
   *   live, with an audience      an ordinary problem
   *   live, `visibleTo: []`       next week's round, not released yet
   *   retired, with an audience   an old problem: read it, but do not submit
   *   retired, `visibleTo: []`    withdrawn along with its statement
   *
   * The third row is the point. Someone who competed on a problem should still
   * be able to open it afterwards, and the contest it belonged to should still
   * render its standings — collapsing the two axes takes both of those away
   * once the round is over.
   *
   * The directory stays in the repository. That is what stops the slug from
   * being reused — the filesystem refuses a second directory by the same name,
   * so no check has to be written and none can be forgotten. Deleting it for
   * real is still possible and still meaningful, and the `restrict` foreign key
   * on `submissions.problem_slug` will make you deal with the history first.
   */
  retired: z.boolean().default(false),

  order: z.number().default(0),
});

export type ProblemConfig = z.infer<typeof problemConfigSchema>;
export type ProblemConfigInput = z.input<typeof problemConfigSchema>;

/**
 * A problem whose judging is dispatched, with the union already narrowed.
 *
 * `externallyJudged()` in `./registry` is how to get a list of them.
 */
export type ExternallyJudged = ProblemConfig & { backend: ExternalBackend };

/**
 * The throttle in force for one person submitting to one problem.
 *
 * Three layers, most specific first: what the contest said when it listed the
 * problem, then what the problem says about itself, then the kernel default.
 * The middle layer is what makes a problem expensive to run say so once
 * instead of in every round that uses it; the first is what lets a round
 * decide otherwise without editing the problem — the same relationship
 * `points` already has with `maxScore`.
 *
 * Takes the override as a bare value rather than a contest entry so that
 * `lib/problems/` stays clear of `lib/contests/`. The caller has the entry in
 * hand anyway, because it had to find it to know the contest contains this
 * problem at all.
 */
export function submitRateLimit(
  problem: ProblemConfig,
  override?: ActionRateLimit,
): ActionRateLimit {
  return override ?? problem.submit.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT;
}

/**
 * What is safe to hand to the browser. `backend` is stripped because its
 * config routinely holds testdata locations, checker settings, or literal
 * answers.
 */
export type PublicProblemConfig = Omit<ProblemConfig, "backend">;

export function toPublicConfig(config: ProblemConfig): PublicProblemConfig {
  const { backend: _backend, ...rest } = config;
  return rest;
}

/** Config plus whatever the registry derived about the problem. */
export interface ProblemEntry {
  config: ProblemConfig;
  /** Path key from `import.meta.glob`, useful for diagnostics. */
  sourcePath: string;
}

/**
 * Every way into this application, and what bounds it.
 *
 * Until this existed, "which endpoints are rate limited" could only be
 * answered by `rg 'rateLimit\('`, and the answer was "the ones somebody
 * remembered" — eight of seventeen, with one privileged path looser than the
 * public form it mirrors. That is the shape `lib/auth/policy.ts` refuses for
 * authorisation, and for the same reason: the value of listing every decision
 * in one place is not the array, it is that the list can be read to the end.
 *
 * So every route handler and every Server Action appears below, and the ones
 * with no bound say so out loud with a reason. `policy.test.ts` walks the
 * filesystem and fails when a handler exists that this table has not heard of,
 * which is what makes adding a route without deciding an error rather than an
 * omission.
 *
 * What this table is not:
 *
 * It is not the only bound on any of these. `proxy.ts` counts by source ahead
 * of every page and Server Action, and `lib/auth/tokens.ts` and
 * `lib/auth/email-verification.ts` hold durable per-recipient cooldowns that
 * survive a restart. Three layers, and they are separated by what each counts:
 * a source, a person, a mailbox.
 *
 * It is not where a competition's numbers live either. A submission's throttle
 * is a decision about how a round runs, so it is declared in `content/` and
 * resolved by `submitRateLimit`; the entries below say `content` rather than
 * repeating a number that is not theirs.
 */

/** What a counter is keyed on. Recorded because it decides what the bound means. */
export type RateLimitSubject =
  /** The signed-in account. Cannot be forged; requires an account to spend. */
  | "handle"
  /** The account plus what it is acting on, so one resource cannot starve another. */
  | "handle+resource"
  /**
   * The address the outermost trusted proxy observed. Raises cost rather than
   * being a boundary — see `./source.ts` on why it can only ever be inferred.
   */
  | "source";

export type RateLimitRule =
  /** A bound the kernel owns, because it is a security parameter. */
  | {
      kind: "fixed";
      max: number;
      windowSeconds: number;
      subject: RateLimitSubject;
    }
  /** A bound a deployment owns, declared in `content/`. */
  | { kind: "content"; subject: RateLimitSubject; declaredIn: string }
  /** No bound, and the reason it is safe not to have one. */
  | { kind: "unlimited"; why: string };

/**
 * Route handlers, keyed `METHOD /path` exactly as the filesystem spells it.
 *
 * Every one of these also takes a coarse per-source bound before it does
 * anything else — see `SOURCE_GATE` below. The rules here are what comes after
 * that, once there is an identity to count.
 */
export const ROUTE_LIMITS = {
  "POST /api/submissions": {
    kind: "content",
    subject: "handle+resource",
    declaredIn: "content/problems/*/problem.ts, content/contests/*/contest.ts",
  },
  "GET /api/submissions": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
  },
  /**
   * Polled, not clicked. `use-submit.ts` backs off from 800ms while a verdict
   * is outstanding and each call runs a queue lookup, so the bound has to sit
   * above what a few tabs legitimately produce rather than at what one does.
   */
  "GET /api/submissions/[id]": {
    kind: "fixed",
    max: 240,
    windowSeconds: 60,
    subject: "handle",
  },
  /**
   * The rate at which streams are opened. How many may be held at once is a
   * different question that a fixed window cannot express — see
   * `./concurrency.ts`, which is what actually bounds this endpoint.
   */
  "GET /api/submissions/stream": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
  },
  "GET /api/judges/status": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
  },
  "POST /api/problems/[slug]/action/[action]": {
    kind: "content",
    subject: "handle+resource",
    declaredIn: "content/problems/*/problem.ts",
  },
  /**
   * The one endpoint with no account behind it, so the source gate is the only
   * per-caller bound there can be. Everything past it — the body read, the
   * HMAC sweep, the row lookup — is work an unauthenticated caller can ask for,
   * which is why that gate runs first rather than after the signature.
   */
  "PUT /api/judge/callback": {
    kind: "unlimited",
    why: "无账号可计数；由 SOURCE_GATE 在读 body 与验签之前挡住",
  },
  /**
   * Unauthenticated by necessity — an orchestrator cannot log in — so the
   * source gate is again the only per-caller bound. It does run a `select 1`,
   * so it is not free; what makes gating it safe is that the compose probe
   * curls localhost from inside the container and therefore resolves to no
   * source at all, leaving the gate stood aside. A 429 here would read as an
   * unhealthy container.
   */
  "GET /api/health": {
    kind: "unlimited",
    why: "存活探针无账号可计数；仍会 select 1，由 SOURCE_GATE 兜底",
  },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Server Actions, keyed by exported function name.
 *
 * These sit behind `proxy.ts` as well, because an action is a POST to the page
 * it is used on. That coverage is real but not something to lean on: Next's own
 * documentation warns that moving an action to another route can silently drop
 * it out of the matcher. So anything that matters is bounded here too.
 */
export const ACTION_LIMITS = {
  login: {
    kind: "fixed",
    max: 10,
    windowSeconds: 300,
    subject: "handle",
  },
  logout: {
    kind: "unlimited",
    why: "只清 cookie，不写库不发信；限它反而会把人卡在登录态里",
  },
  sendCodeAction: { kind: "content", subject: "source", declaredIn: "content/enrollment/*.ts" },
  verifyCodeAction: { kind: "content", subject: "source", declaredIn: "content/enrollment/*.ts" },
  registerAction: { kind: "content", subject: "source", declaredIn: "content/enrollment/*.ts" },
  requestPasswordReset: {
    kind: "fixed",
    max: 10,
    windowSeconds: 3600,
    subject: "source",
  },
  resetPasswordAction: {
    kind: "fixed",
    max: 20,
    windowSeconds: 3600,
    subject: "source",
  },
  /**
   * Mail somebody did not ask for, sent by an operator.
   *
   * This was the gap that made the table worth building: the public
   * `requestPasswordReset` above is bounded per source, and this — the
   * privileged path that does the same thing — had nothing. The per-recipient
   * cooldown in `lib/mail/notify.ts` only stops the *same* account being mailed
   * twice a minute, so a stolen `credential.manage` session could send one
   * message per account per minute, indefinitely, from this deployment's
   * domain. Sending mail has a cost that lands on somebody else's inbox and on
   * this domain's reputation.
   */
  resendPasswordResetAction: {
    kind: "fixed",
    max: 10,
    windowSeconds: 3600,
    subject: "handle",
  },
  suspendAccountAction: {
    kind: "unlimited",
    why: "写自己库里的一行，且 account.moderate 拒绝带权限的目标；成本不外溢",
  },
  reinstateAccountAction: {
    kind: "unlimited",
    why: "同 suspendAccountAction",
  },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The coarse bound every route handler takes before anything else.
 *
 * `/api/*` is deliberately outside the `proxy.ts` matcher: when proxy runs for
 * a route, Next clones and buffers the request body so both can read it, and
 * that would turn `readTextBody`'s streaming count into a cancel against an
 * already-materialised copy. Keeping API routes out preserves the streaming
 * defence and costs them the global layer — so they take an equivalent bound
 * on their own first line instead, and this table is what stops one being
 * forgotten.
 *
 * Sized as a flood cap rather than a policy: well above any real client,
 * low enough that one source cannot occupy the process.
 */
export const SOURCE_GATE = { max: 300, windowSeconds: 60 } as const;

export type RouteKey = keyof typeof ROUTE_LIMITS;
export type ActionKey = keyof typeof ACTION_LIMITS;

/** Narrowed accessor, so a caller cannot read a bound off the wrong shape. */
export function fixedRule(
  rule: RateLimitRule,
): { max: number; windowSeconds: number } {
  if (rule.kind !== "fixed") {
    throw new Error("这条入口的限流不是内核固定值，不能从这里取");
  }
  return { max: rule.max, windowSeconds: rule.windowSeconds };
}

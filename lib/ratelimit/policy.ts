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
 *
 * Route entries carry a second decision, `guard`, for the same reason the
 * bounds are here rather than at each handler: a cross-origin defence that
 * lives in a route is a defence the next route forgets. Keeping it in the table
 * means the completeness test below makes a new handler state its answer, and
 * `guardRequest` in `./gate.ts` applies whatever it said.
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

/**
 * A second bound on the same entry point, counting a different subject.
 *
 * Two entries below have one, and both have it for the same reason: a counter
 * is blind to the abuse the other exists to catch, so neither number alone is
 * the answer. Login counts a handle, which sees somebody grinding one
 * account's password and not somebody spraying one password across a hundred
 * of them, where each account is tried once. Submissions count a handle *and*
 * the problem, so that a round can set its own throttle — which leaves one
 * account free to spend a full budget on every open problem at once.
 *
 * So the invariant that makes a second bound worth writing down is that it
 * counts something the first does not, and `policy.test.ts` checks exactly
 * that. Two bounds on the same subject would be one bound and an argument
 * about which number wins.
 *
 * Two things it deliberately is not. It carries no `kind`, because a second
 * bound has so far always been the kernel's floor under somebody else's
 * policy, and a floor a deployment can raise is not a floor — the day one is
 * genuinely a `content/` decision is the day this grows the same three-way
 * split the primary has. And it is one bound rather than a list, because
 * nothing here needs a third and a list would make every reader handle a case
 * that does not exist.
 */
export interface AlsoBound {
  max: number;
  windowSeconds: number;
  subject: RateLimitSubject;
  /** Which abuse this catches that the bound beside it cannot see. */
  why: string;
}

export type RateLimitRule =
  /** A bound the kernel owns, because it is a security parameter. */
  | {
      kind: "fixed";
      max: number;
      windowSeconds: number;
      subject: RateLimitSubject;
      also?: AlsoBound;
    }
  /** A bound a deployment owns, declared in `content/`. */
  | {
      kind: "content";
      subject: RateLimitSubject;
      declaredIn: string;
      also?: AlsoBound;
    }
  /**
   * No bound, and the reason it is safe not to have one.
   *
   * No `also` here, and that is a type error worth having rather than an
   * omission: an entry with a second bound and no first one is a `fixed` entry
   * that has not admitted it.
   */
  | { kind: "unlimited"; why: string };

/**
 * Whether a request has to prove it came from this deployment's own pages.
 *
 * The question exists because the session cookie is *ambient*: the browser
 * attaches it to anything addressed at this host, whoever asked for the
 * request. `SameSite=Lax` — what Auth.js sets, and this deployment does not
 * override it — is often mistaken for the answer, but Lax is scoped to a
 * *site*, meaning the registrable domain. A page on any sibling subdomain of
 * the same university domain is same-site, so its form POST arrives here
 * carrying the victim's session in full.
 *
 * So the exemptions are the interesting part, and they are three different
 * arguments that a boolean "does it write" could not tell apart.
 */
export type OriginGuard =
  /**
   * Enforced. The cookie is the entire credential, so the request must also
   * carry evidence that a page on this origin is what asked for it.
   */
  | "same-origin"
  /**
   * Exempt because there is nothing to forge. A cross-site request can already
   * cause a read; what it cannot do is see the answer, since no CORS header
   * here ever lets a response be read by another origin.
   */
  | "read-only"
  /**
   * Exempt because the credential is not ambient. A judge callback proves
   * itself with an HMAC it had to be given, which a browser cannot compute and
   * would not send — so requiring an `Origin` of it would refuse every
   * legitimate caller in exchange for nothing.
   */
  | "signed"
  /**
   * Exempt because the check is already being made, by something that is not
   * `guardRequest`. The one route this covers is Auth.js's own, which pairs a
   * `csrfToken` field in the body against a cookie holding the same value and
   * refuses a POST that cannot produce both — a defence a cross-origin page
   * cannot satisfy, since it cannot read the cookie to copy it.
   *
   * Different from `signed` in what it rests on. There the credential is not
   * ambient and so there is nothing to forge; here the credential *is* ambient
   * and a second, non-ambient one is demanded alongside it. Same outcome,
   * opposite reason, and a reader who conflated them would go looking for an
   * HMAC that does not exist.
   *
   * The same argument is why Server Actions carry no `guard` at all — see
   * `ACTION_LIMITS` below.
   */
  | "framework";

/** A route's two decisions: what bounds it, and what may originate it. */
export type RouteRule = RateLimitRule & { guard: OriginGuard };

/**
 * Route handlers, keyed `METHOD /path` exactly as the filesystem spells it.
 *
 * Every one of these takes a coarse per-source bound before it does anything
 * else — see `SOURCE_GATE` below. The rules here are what comes after that,
 * once there is an identity to count.
 *
 * That sentence is universal again. `/api/auth/[...nextauth]` was the
 * exception for as long as its handlers were re-exported whole, which left no
 * first line to put `guardRequest` on; it is now wrapped, and the wrapper adds
 * only the flood cap because `originGate` reads the guard from here and both
 * of its entries decline the origin check.
 */
export const ROUTE_LIMITS = {
  /**
   * The one entry where both halves of the `content`/`fixed` split appear at
   * once: the round owns the throttle, the kernel owns the floor underneath
   * it, and neither is the other's business. The handler reads both back out
   * of here rather than spelling either one itself.
   */
  "POST /api/submissions": {
    kind: "content",
    subject: "handle+resource",
    declaredIn: "content/problems/*/problem.ts, content/contests/*/contest.ts",
    also: {
      max: 60,
      windowSeconds: 60,
      subject: "handle",
      why:
        "按题计数是比赛自己的决定，管不住一个账号同时对每一道开放的题各花满一份预算——" +
        "单个全局计数器原本挡的就是这种用法。这一条是内核压在下面的地板，" +
        "定在任何真人都够不到的高度：它防的是一个被盗账号占满评测机，不是塑造玩法。",
    },
    guard: "same-origin",
  },
  "GET /api/submissions": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
    guard: "read-only",
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
    guard: "read-only",
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
    guard: "read-only",
  },
  "GET /api/judges/status": {
    kind: "fixed",
    max: 60,
    windowSeconds: 60,
    subject: "handle",
    guard: "read-only",
  },
  /**
   * Guarded for a sharper reason than the submission route: an action reaches
   * a problem's backend, and `spawn` costs a container.
   */
  "POST /api/problems/[slug]/action/[action]": {
    kind: "content",
    subject: "handle+resource",
    declaredIn: "content/problems/*/problem.ts",
    guard: "same-origin",
  },
  /**
   * The three endpoints runners use, and the only ones here with no account
   * behind them — so the source gate is the only per-caller bound there can be.
   * Everything past it (the body read, the HMAC, the row lookup) is work an
   * unauthenticated caller can ask for, which is why that gate runs first
   * rather than after the signature.
   *
   * The claim below is also the one legitimately high-rate caller in this
   * table: a runner short-polls it, and `SOURCE_GATE` allows five runners
   * polling once a second from behind one address before it starts refusing.
   * That is the sizing the protocol assumes — poll every one to two seconds —
   * and a deployment that outgrows it wants the runners on their own addresses
   * rather than a looser cap, since the same number is what keeps an
   * unauthenticated caller from occupying the process.
   */
  "POST /api/runner/jobs/request": {
    kind: "unlimited",
    why: "评测机无账号可计数；由 SOURCE_GATE 在读 body 与验签之前挡住",
    guard: "signed",
  },
  "GET /api/runner/jobs/[id]": {
    kind: "unlimited",
    why: "同上；且必须持有该行当前的 lease 才拿得到内容",
    guard: "signed",
  },
  "PUT /api/runner/jobs/[id]": {
    kind: "unlimited",
    why: "同上；每次上报都要比对 lease，陈旧的持有者写不进任何东西",
    guard: "signed",
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
    guard: "read-only",
  },
  /**
   * Auth.js's handlers, wrapped in `guardRequest` like every other route here.
   *
   * The wrapper was argued against once, and the argument was wrong in a way
   * worth leaving written down: it assumed adding the guard meant adding the
   * origin check, and that a `same-origin` declaration would refuse every
   * sign-in through the form content-type rule. Both halves of that are true.
   * What it missed is that `originGate` reads the guard off this table and
   * returns immediately for anything that is not `same-origin` — so the two
   * entries below already say "not ours to check", and wrapping adds the flood
   * cap alone. The choice was never between all of the guard and none of it.
   *
   * The other half of that argument was that the per-source budget is
   * collective, so a lab behind one campus address would lock each other out.
   * It does not apply here, and the reason is specific rather than a matter of
   * sizing: nothing in this application reaches this route. `signIn` and
   * `signOut` in a Server Action call `Auth(req, { raw, skipCSRFCheck })`
   * in-process, there is no `useSession` and no `SessionProvider` polling
   * `/api/auth/session`, and no page links here. Legitimate traffic is
   * whatever posts straight to `/callback/credentials`, which is a real path
   * — `authorize` is deliberately where `login` is counted so that it stays
   * bounded — but it is not one a browser reaches by using the site.
   *
   * So `kind` stays `unlimited` and means what it says: no bound keyed on an
   * identity, because there is no identity here to key on. `login` below
   * bounds the only action that costs anything, from inside `authorize`, for
   * this route and the Server Action alike. `SOURCE_GATE` now covers the rest.
   */
  "POST /api/auth/[...nextauth]": {
    kind: "unlimited",
    why:
      "唯一有代价的动作是登录尝试，由下面的 `login` 在 authorize 里按 handle 与来源双重计数；" +
      "其余端点（signout、session 更新）只改 cookie 与解 JWT，不读库。量由 SOURCE_GATE 兜住",
    guard: "framework",
  },
  "GET /api/auth/[...nextauth]": {
    kind: "unlimited",
    why: "session / csrf / providers 只解 JWT 并回读仓库里的授予，不读库；量由 SOURCE_GATE 兜住",
    guard: "read-only",
  },
} as const satisfies Record<string, RouteRule>;

/**
 * Server Actions, keyed by exported function name.
 *
 * These sit behind `proxy.ts` as well, because an action is a POST to the page
 * it is used on. That coverage is real but not something to lean on: Next's own
 * documentation warns that moving an action to another route can silently drop
 * it out of the matcher. So anything that matters is bounded here too.
 *
 * No `guard` field, and that is not an omission. Next compares the origin of
 * every Server Action request against the host itself and refuses a mismatch,
 * so the check route handlers need here is one actions already have from the
 * framework. Restating it would invite the two to drift.
 */
export const ACTION_LIMITS = {
  /**
   * The one entry where getting the bound wrong costs more than throughput.
   *
   * Every attempt costs an argon2 verify at 19 MiB, and `authorize` runs one
   * even for a handle that does not exist so that the timing gives nothing
   * away. An unmetered login is therefore a memory and CPU amplifier as well
   * as a guessing oracle, which is what puts both numbers here rather than at
   * whatever felt generous.
   *
   * Counted in the `authorize` callback rather than in the Server Action this
   * entry is keyed by, and the key is still the right one: `login` is the
   * activity, and the callback is the only point every instance of it passes
   * through. Posting straight to `/api/auth/callback/credentials` skips the
   * action, which is exactly what anybody grinding passwords would do — see
   * that route's entry in `ROUTE_LIMITS`, which points back here.
   */
  login: {
    kind: "fixed",
    max: 10,
    windowSeconds: 300,
    subject: "handle",
    also: {
      max: 40,
      windowSeconds: 300,
      subject: "source",
      why:
        "按 handle 计数只看得见对着一个账号猜密码。把同一个弱密码撒向一百个账号的人，" +
        "每个账号只试一次，那个计数器永远不会响",
    },
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
  /**
   * Bounded, unlike the two above, because the cost does not stop at this
   * deployment's own database: each one puts a job back on a queue that a
   * runner will pick up and actually evaluate, which can mean a container, a
   * compile and eight seconds of a timed machine. One row per press, so the
   * number only has to sit above what an operator working through a bad round
   * legitimately does.
   */
  rejudgeSubmissionAction: {
    kind: "fixed",
    max: 120,
    windowSeconds: 3600,
    subject: "handle",
  },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The coarse bound every route handler of ours takes before anything else.
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
 *
 * It reaches every route, `/api/auth/[...nextauth]` included. That one is
 * Auth.js's handler rather than one of ours, so it gets there through a thin
 * wrapper; the entry above says why that wrapper adds this bound and not the
 * origin check beside it.
 */
export const SOURCE_GATE = { max: 300, windowSeconds: 60 } as const;

export type RouteKey = keyof typeof ROUTE_LIMITS;

/** Narrowed accessor, so a caller cannot read a bound off the wrong shape. */
export function fixedRule(
  rule: RateLimitRule,
): { max: number; windowSeconds: number } {
  if (rule.kind !== "fixed") {
    throw new Error("这条入口的限流不是内核固定值，不能从这里取");
  }
  return { max: rule.max, windowSeconds: rule.windowSeconds };
}

/**
 * The same for an entry's second bound.
 *
 * A separate call rather than a field on the result above, because a caller
 * that wants both wants them in two named variables — `PER_HANDLE` and
 * `PER_SOURCE` in `auth.ts` read as the two different questions they are —
 * and a caller that only knows about one should get an error rather than
 * quietly the wrong number.
 */
export function alsoRule(
  rule: RateLimitRule,
): { max: number; windowSeconds: number } {
  if (rule.kind === "unlimited" || rule.also === undefined) {
    throw new Error("这条入口没有第二重限流");
  }
  return { max: rule.also.max, windowSeconds: rule.also.windowSeconds };
}

import { getTableColumns, sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SubmissionState, Verdict } from "@/lib/backend/types";

/**
 * The database holds two kinds of thing and nothing else:
 *
 *   1. secrets and personal data, which cannot be committed — `accounts`
 *      (the email address and the password hash), `auth_tokens`,
 *      `email_verifications`
 *   2. things that actually happened — `submissions`, every row in `accounts`
 *      that came from someone filling in the registration form, and the
 *      `problems` and `contests` rows written when a submission first
 *      referenced them
 *
 * What is deliberately absent is any column an administrator would want to
 * edit in order to change what somebody may do. Groups are not stored:
 * `content/enrollment/` declares the rules that produce them and
 * `lib/permissions/policy.ts` declares what each capability means, so a privilege
 * change is a reviewed commit rather than an UPDATE nobody can find
 * afterwards.
 */

/**
 * Who exists.
 *
 * The table holds no authority of its own: `handle`, `displayName` and `email`
 * say who someone claims to be, `passwordHash` is how they prove it, and
 * `status` says whether they may act at all. The answer to "what may they do"
 * is computed in `lib/accounts/resolve.ts` from the email address and the
 * rules in `content/enrollment/`, and is never written back — see the note on
 * tags there.
 *
 * `email` is nullable only for accounts predating the current registration
 * flow; both ways in supply one now. The unique index tolerates the nulls that
 * remain because Postgres does not consider two of them equal.
 */
export type AccountStatus = "active" | "suspended";

export type AccountSource = "bootstrap" | "registration";

export const accounts = pgTable(
  "accounts",
  {
    /** Lowercased. `normalizeHandle` in `lib/accounts/types.ts` does this. */
    handle: text("handle").primaryKey(),
    displayName: text("display_name").notNull(),

    /**
     * Normalised (lowercased, optionally sub-address stripped) before it gets
     * here, because it decides which cohort tags the account resolves to and
     * two spellings of one mailbox must not become two cohorts.
     */
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    /**
     * The one field here that is a secret rather than a claim, and the reason
     * `accountColumns` below exists: every read that is not the login path
     * goes through that projection, so the hash cannot reach a page by being
     * carried along inside a row somebody selected with `*`.
     *
     * Null for an account nobody has chosen a password for yet — which is a
     * real state, not a placeholder: `scripts/create-account.cjs` can make an
     * account whose owner sets the password from a reset link.
     */
    passwordHash: text("password_hash"),

    /**
     * When the hash beside it was last written, and nothing else.
     *
     * Separate from `updatedAt` because it is the clock a session is pinned
     * to: `verifyPassword` reads it into the JWT and `sessionMatchesPassword`
     * reads it back out, so anything that advances it ends every session
     * issued before it. `updatedAt` moves when an account is suspended or
     * reinstated, and a moderator reversing their own decision must not
     * thereby sign the account out.
     *
     * Written by the database rather than by this process. Both values in
     * every comparison come from this column, and a `new Date()` on one side
     * of it puts a second clock in the pair — where the two disagree by more
     * than the argon2 work between them, a reset stamps the row *earlier* than
     * the session it was meant to end and the session survives.
     */
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),

    source: text("source")
      .$type<AccountSource>()
      .notNull()
      .default("registration"),
    status: text("status").$type<AccountStatus>().notNull().default("active"),

    /**
     * Suspension is data rather than a line in the repository — the one
     * exception to the note above — so the audit columns are what keep it an
     * accountable act.
     *
     * All four describe the *most recent* suspension, not the current state.
     * `status` is the only thing that answers whether somebody may act; none
     * of these four may be read as a predicate, and they survive a
     * reinstatement precisely so that a reversed decision still leaves a
     * trace. `reinstatedAt` is cleared by `suspendAccount`, so the pair always
     * describes one episode rather than two halves of different ones.
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedBy: text("suspended_by"),
    suspendedReason: text("suspended_reason"),
    reinstatedAt: timestamp("reinstated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_email_key").on(table.email),
    index("accounts_status_idx").on(table.status),
    // The two password columns are one fact and are always written together,
    // which is what lets `AccountRow` carry only the timestamp and still
    // answer "does this account have a password". Enforced here rather than
    // trusted, because the projection depends on it: with a hash and no
    // timestamp the console would report an account as having no password
    // while its owner logs in perfectly well.
    check(
      "accounts_password_pair_ck",
      sql`(${table.passwordHash} is null) = (${table.passwordSetAt} is null)`,
    ),
  ],
);

/**
 * Every column of `accounts` except the hash.
 *
 * The default projection: `lib/accounts/queries.ts` selects this and nothing
 * selects `accounts` whole, so a row handed to a page cannot be carrying a
 * password hash it had no reason to fetch. That matters more than it sounds
 * like, because these rows are read in server components and the ones that
 * pass a row to a client component would serialise every field of it into the
 * RSC payload.
 *
 * Derived by subtraction rather than listed, so a column added above is in it
 * by default and only the hash has to be argued for. The login path in
 * `lib/accounts/password.ts` names the two columns it needs by hand, which is
 * the whole of the code that may see one.
 */
const { passwordHash: _passwordHash, ...accountColumnsWithoutHash } =
  getTableColumns(accounts);

export const accountColumns = accountColumnsWithoutHash;

/**
 * Single-use, hashed, expiring secrets mailed to the owner of an account.
 *
 * Down to one purpose, and kept as a `purpose` column anyway: it costs a text
 * field and is what makes the next one an insert rather than a migration.
 *
 * Only the digest is stored. A row is consumed rather than deleted so that
 * "this link has already been used" stays distinguishable from "this link
 * never existed", and so that a recently issued token can throttle the next
 * request for one without a separate rate-limit store.
 */
export type TokenPurpose = "password_reset";

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    handle: text("handle")
      .notNull()
      .references(() => accounts.handle, { onDelete: "cascade" }),
    purpose: text("purpose").$type<TokenPurpose>().notNull(),

    /** SHA-256. The plaintext is 160 bits of randomness, shown once. */
    tokenHash: text("token_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A link in an email carries the token and nothing else, so redemption
    // has to be able to find the row from the digest alone.
    uniqueIndex("auth_tokens_token_hash_key").on(table.tokenHash),
    index("auth_tokens_handle_idx").on(
      table.handle,
      table.purpose,
      table.createdAt,
    ),
  ],
);

/**
 * Proof that whoever is filling in the registration form can read the address
 * they typed — established before there is an account to attach it to.
 *
 * This is why it is not a third `auth_tokens` purpose: that table's `handle`
 * is NOT NULL and references `accounts`, which presumes the very thing
 * registration has not done yet. Keyed by the address instead, one row per
 * mailbox, because one mailbox has at most one signup in flight.
 *
 * The code is short enough to be retyped from a phone, which changes what
 * "store the digest" is worth. Six digits is a space of a million, so the
 * digest cannot be the lookup key the way a 160-bit token's is — that would be
 * an invitation to grind it. The row is found by address and the code only
 * ever compared, `attempts` caps how many times that may fail, and the address
 * goes into the digest so a code mailed to one mailbox cannot be spent on
 * another.
 *
 * `expiresAt` is one deadline covering two phases: until the code is redeemed
 * it is the code's, and redemption pushes it out to leave time for the rest of
 * the form. A row survives redemption because `verifiedAt` is what the
 * registration itself checks; it is deleted once an account exists.
 */
export const emailVerifications = pgTable("email_verifications", {
  /** Normalised the same way `accounts.email` is, and for the same reason. */
  email: text("email").primaryKey(),

  /** SHA-256 of `email:code`. See the note above on why it is not a key. */
  codeHash: text("code_hash").notNull(),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  /** Failed comparisons. Past the cap the row is spent and a new code is the
   * only way forward — which the resend cooldown paces. */
  attempts: integer("attempts").notNull().default(0),

  verifiedAt: timestamp("verified_at", { withTimezone: true }),

  /** When the code went out. The resend cooldown reads this, for the reason
   * given in `lib/accounts/tokens.ts`: the row recording the send is the row
   * recording when. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The problems somebody has submitted to.
 *
 * Not a mirror of `content/problems`. Rows are written by `ensureProblem` at
 * the moment a submission first needs the foreign key, so what accumulates
 * here is a normalised index of every problem this deployment has ever judged
 * — including ones since deleted from the repository, which is what keeps
 * their submissions attributable.
 *
 * `title` is a snapshot that tracks the registry, kept so a submission list can
 * name a problem that no longer exists. Everything else about a problem —
 * scoring, audience, backend — is read from `content/problems`, which is why
 * there is nothing else here.
 */
export const problems = pgTable("problems", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The contests somebody has submitted during, for the same reason as above and
 * no other. Schedule, problem set and entry rules are all in the registry —
 * this is a foreign key anchor, which is why it has no `starts_at`.
 *
 * Nothing deletes from here: a contest removed from the repository keeps its
 * row so that submissions made during it stay attributable. `/admin` reports
 * it rather than anything detaching that history on its own.
 */
export const contests = pgTable("contests", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey(),

    /**
     * Restrict rather than cascade: a submission is an audit record, and
     * deleting an account should not quietly erase what it did. Suspending is
     * the reversible action; removal has to deal with the history first.
     */
    handle: text("handle")
      .notNull()
      .references(() => accounts.handle, { onDelete: "restrict" }),

    /**
     * Restrict for the same reason `handle` is: the row it points at is what
     * makes this submission attributable, and `/admin` lists problems deleted
     * from the repository precisely because their submissions are still here.
     * Under `cascade`, tidying up one such row takes every submission to that
     * problem with it.
     */
    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "restrict" }),
    contestSlug: text("contest_slug").references(() => contests.slug, {
      onDelete: "set null",
    }),

    /** Whatever the statement's submitter produced. Never read by the kernel. */
    payload: jsonb("payload").$type<unknown>().notNull(),

    /**
     * What the browser called this attempt, so that repeating it does not
     * repeat the submission.
     *
     * Every other step of the judging loop is idempotent on its own — a report
     * has to hold the current lease, the state guards make the first verdict
     * win, `ensureProblem` upserts — and the entrance is the one place a retry
     * would otherwise cost a second row and a second slot in the queue, for
     * one thing the player did once. The client mints one of these per attempt
     * and reuses it when a submit has to be retried, so a request whose reply
     * was lost can be re-asked and answered from the row it already made.
     *
     * Nullable, and the unique index below is what makes that work: Postgres
     * does not consider two nulls equal, so submissions from anything that
     * sends no nonce — a script, an older client — never collide with each
     * other. Scoped to the handle rather than global, because it is a client's
     * private counter and two people must not be able to collide on purpose.
     *
     * Deliberately not derived from the payload. Two identical submissions a
     * minute apart are two submissions, and hashing the body would silently
     * refuse the second.
     */
    clientNonce: text("client_nonce"),

    state: text("state").$type<SubmissionState>().notNull().default("queued"),

    /**
     * Whatever the backend returned, verbatim.
     *
     * The mirror image of `payload`. `reportDone` parses it once and the
     * columns below are what the kernel kept, so this is the audit copy and
     * nothing in the kernel may read a field out of it — the same number
     * reachable both here and as a column, with nothing saying which is
     * authoritative, is the failure mode being avoided. Only a problem's own
     * components look inside it; see `detail` in `lib/backend/types.ts`.
     */
    verdict: jsonb("verdict").$type<Verdict>(),

    /** What the backend reported, or null if it reported no score at all. */
    score: doublePrecision("score"),

    /**
     * The denominator this judging actually used: what the backend declared,
     * falling back to the problem's configured `maxScore`. Resolved on the way
     * in so a later edit to the configuration cannot change what an old
     * submission was scored out of.
     */
    maxScore: doublePrecision("max_score"),

    /**
     * Whether the backend declared this a pass.
     *
     * Null means it did not say, not that it failed — `score >= maxScore` is
     * the fallback, and it lives in `isAccepted` rather than here on purpose.
     * A backend saying "this counts as solved" is a fact and belongs in a
     * column; the kernel guessing on its silence is a guess, and burning a
     * guess into history would mean an improved rule could never reach the
     * submissions it was written for. Problems that need it are the ones where
     * full marks and passing differ — a performance task where two times
     * baseline passes and three scores full.
     */
    accepted: boolean("accepted"),

    /**
     * The backend's own status string, for the badge. An opaque label:
     * `presentation.verdicts` translates the ones a deployment names, and
     * anything else renders as itself.
     */
    outcome: text("outcome"),

    /**
     * What judged this, and against what.
     *
     * A verdict is only reproducible if both ends are pinned. `releaseSha` is
     * the commit this kernel was built from, which fixes the problem's entire
     * definition because `content/` lives in the same repository.
     * `backendVersion` is what the backend said about itself, and it covers
     * the half that is not in this repository at all: the testdata, the
     * checker, the judging code.
     *
     * Both are snapshots rather than references. A row here says what was true
     * at the moment of judging, so pointing them at a lookup table would let a
     * later UPDATE rewrite history — the same reason `payload` and `verdict`
     * are stored inline.
     *
     * Nullable despite `backendVersion` being required by the protocol: rows
     * written before this existed genuinely have no answer, and inventing one
     * would defeat the purpose. `releaseSha` is additionally null for images
     * built outside CI, which did not come from a commit.
     */
    releaseSha: text("release_sha"),
    backendVersion: text("backend_version"),

    /**
     * Which backend this belongs to.
     *
     * In the pull model it is the queue selector rather than an address book
     * entry — a runner signing as `traditional` is handed rows carrying
     * `traditional` here, and nothing else.
     */
    backendId: text("backend_id").notNull(),

    /**
     * Who is holding this row, and their proof of it.
     *
     * The lease is what makes a stale report cheap to refuse. Without it,
     * deciding whether an arriving result is current means reasoning about a
     * runner's identity crossed with how many times the row has been handed
     * out — and identity alone is not enough, because the case worth catching
     * is runner A going quiet, the row being requeued, and A waking up to
     * report on work that is now somebody else's. A does not stop being A. It
     * stops holding the lease.
     *
     * Not a credential: the HMAC on the request is what proves the caller is
     * the backend it claims to be. This proves the caller is the *current*
     * holder of this particular row, which is a different question, and the
     * reason it is compared in the `where` clause of every write rather than
     * checked up front — the comparison and the write have to be one statement
     * or a requeue can slip between them.
     *
     * `runnerId` is the runner's own name for itself, kept for the board and
     * for logs. Nothing authorises on it.
     */
    runnerId: text("runner_id"),
    lease: text("lease"),

    /**
     * The runner's account of what it is doing, in its own words.
     *
     * Stored and served verbatim. "拉取镜像" and "测试点 3/10" are both fine and
     * the kernel understands neither — see `runnerStatusSchema`. Cleared when a
     * row is requeued, because it described a holder that is gone.
     */
    runnerStatus: text("runner_status"),

    /**
     * When the holder last said it was alive.
     *
     * The one clock the reaper reads. It answers "how long since anybody said
     * anything", which is a property of neither the problem nor the backend —
     * which is why there is no per-problem or per-backend abandonment
     * deadline to configure alongside it.
     */
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),

    /**
     * How many times this row has been handed out.
     *
     * A row that is claimed, goes quiet, is requeued and claimed again is
     * either unlucky or poison, and the count is the only thing that tells the
     * two apart. Past the cap it stops being offered and the reaper gives up on
     * it, so a submission that reliably kills whatever picks it up cannot cycle
     * through every runner in turn, forever.
     *
     * Reset by a rejudge, because an administrator asking for this to be tried
     * again is asking for a fresh budget rather than the last of an old one.
     */
    attempts: integer("attempts").notNull().default(0),

    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * When this row last entered the queue, which is not when it was created,
     * and the difference is load-bearing in both directions.
     *
     * Two paths put a row back in `queued` without touching `created_at`: the
     * reaper taking a job back from a holder that went quiet, and an
     * administrator rejudging. So every reader that means "who has been
     * waiting longest" must name this column — the queue fuse, `claimJob`'s
     * ordering, and the positions computed in
     * `lib/submissions/queue-position.ts`. On `created_at` the fuse writes off
     * any submission older than its window on the next tick, and `claimJob`
     * puts a requeued row in front of everything submitted since, so a batch
     * rejudge mid-round jumps the entire queue backwards.
     *
     * `created_at` cannot be advanced instead: it is what a submission list
     * shows and what the contest window is compared against, so moving it on a
     * rejudge relocates the submission inside the round it was made during.
     *
     * `not null` with a default, and written explicitly at all three places a
     * row becomes `queued`, so that a fourth cannot leave behind a row those
     * readers silently mis-order or decline to consider.
     */
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** When a runner took it. Null again after a requeue. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (table) => [
    index("submissions_standings_idx").on(
      table.contestSlug,
      table.problemSlug,
      table.handle,
      table.createdAt,
    ),
    /**
     * Handing out work, and the two sweeps that conclude on a queued row.
     *
     * Backend first because a claim is always for one backend's queue; the
     * timestamp after it, because oldest-first is the whole ordering policy.
     * Partial on `queued` because a row nobody is holding is the only kind
     * that can be handed out, and the set of them is small and short-lived
     * even when the table is not.
     *
     * `queued_at` and not `created_at`, for the reason given on the column,
     * and it has to stay the same clock the fuse filters on or the sweep walks
     * this index only to recheck every row it matches against the heap.
     *
     * Both sweeps read it without the leading column, because they want every
     * backend's stale entries rather than one queue's: a scan of this index
     * rather than a seek, which is the right trade against a second index over
     * a set that is usually empty. The second of them narrows on `attempts`,
     * which is not in here at all, so those rows are rechecked against the
     * heap — see `reapOnce` for why a submission that has killed three runners
     * in a row does not earn an index of its own either.
     */
    index("submissions_queued_idx")
      .on(table.backendId, table.queuedAt)
      .where(sql`state = 'queued'`),
    /**
     * Taking work back. Partial for the same reason and more sharply: a healthy
     * deployment has every `judging` row heartbeating, so this normally finds
     * nothing, and indexing the finished millions to find none of them is
     * exactly the cost being avoided.
     */
    index("submissions_lapsed_idx")
      .on(table.lastHeartbeatAt)
      .where(sql`state = 'judging'`),
    /**
     * The disruption count `/admin` opens with.
     *
     * `recentDisruptions` asks for `state = 'disrupted' and judged_at >= ?`,
     * and nothing above covers it: `submissions_standings_idx` leads on the
     * contest and the two partial ones select other states. Without this, the
     * console is a sequential scan of every submission ever made, on every
     * page load, to return an answer that is normally zero.
     *
     * Partial for the same reason as the two above, and more sharply than
     * either: a deployment where `disrupted` is anything but rare has a problem
     * this page exists to report, so the indexed set stays small by
     * construction. The predicate leaves the state out of the key — every row
     * in here has the same one — and keeps `judged_at`, which is what the
     * window is compared against.
     */
    index("submissions_disrupted_idx")
      .on(table.judgedAt)
      .where(sql`state = 'disrupted'`),
    index("submissions_handle_idx").on(table.handle, table.createdAt),
    // The idempotency key itself, not merely an index over it: the submit
    // route reads before it writes, and two clicks racing would both pass that
    // read. This is what makes the second insert lose.
    uniqueIndex("submissions_client_nonce_key").on(
      table.handle,
      table.clientNonce,
    ),
  ],
);

/**
 * The runners that have shown up, and when each was last seen.
 *
 * Self-reported and unverified, which is the whole shape of it: a row appears
 * the first time something signing as this backend asks for work and calls
 * itself this name, and it is refreshed on every subsequent ask. There is no
 * registration step, no per-runner credential and nothing to revoke — anything
 * holding the backend's key is a runner for that backend, so a compromised
 * machine is dealt with by rotating that key, not by deleting a row here.
 *
 * Not a registry: there is deliberately no address column, because a runner
 * has no inbound address and inventing one would be a second place to look up
 * something already declared in `content/backends.ts`.
 *
 * It exists to answer one question nothing else can: **is anybody out there?**
 * A deep queue with runners on it means work is arriving faster than it is
 * finished; the same queue with no runners means nobody is evaluating at all,
 * and those two call for opposite responses from an operator.
 *
 * Nothing prunes it, and the board filters on `lastSeenAt` rather than on the
 * row existing — a runner that never comes back is a fact worth seeing.
 */
export const runners = pgTable(
  "runners",
  {
    backendId: text("backend_id").notNull(),
    /** The runner's own name for itself. Unverified — see above. */
    runnerId: text("runner_id").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite rather than a surrogate id: the pair *is* the identity, and a
    // generated key would let one runner accumulate a row per restart.
    primaryKey({ columns: [table.backendId, table.runnerId] }),
  ],
);

/**
 * An account as everything but the login path sees one.
 *
 * Deliberately not `$inferSelect`: that includes `passwordHash`, and a type
 * that admits the hash is a type that lets a page render it. What a caller
 * wanting to know whether an account has a password reads is `passwordSetAt`,
 * which the check constraint above keeps in step with the hash.
 */
export type AccountRow = Omit<typeof accounts.$inferSelect, "passwordHash">;
export type AuthTokenRow = typeof authTokens.$inferSelect;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type RunnerRow = typeof runners.$inferSelect;

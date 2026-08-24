import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SubmissionState, Verdict } from "@/lib/backend/types";

/**
 * The database holds two kinds of thing and nothing else:
 *
 *   1. secrets and personal data, which cannot be committed — `accounts`
 *      (the email address), `credentials`, `auth_tokens`,
 *      `email_verifications`
 *   2. things that actually happened — `submissions`, every row in `accounts`
 *      that came from someone filling in the registration form, and the
 *      `problems` and `contests` rows written when a submission first
 *      referenced them
 *
 * There used to be a third kind, mirrors of the filesystem registries pushed
 * in at startup. They turned out to be the second kind all along: nothing read
 * a row for a problem nobody had submitted to.
 *
 * What is deliberately absent is any column an administrator would want to
 * edit in order to change what somebody may do. Groups are not stored:
 * `content/enrollment/` declares the rules that produce them and
 * `lib/auth/policy.ts` declares what each capability means, so a privilege
 * change is a reviewed commit rather than an UPDATE nobody can find
 * afterwards.
 */

/**
 * Who exists.
 *
 * Almost every row here is created by the registration form, which is why the
 * table holds no authority of its own: `handle`, `displayName` and `email` say
 * who someone claims to be, and `status` says whether they may act at all. The
 * answer to "what may they do" is computed in `lib/accounts/resolve.ts` from
 * the email address and the rules in `content/enrollment/`, and is never
 * written back — see the note on tags there.
 *
 * `email` is nullable only because accounts predating the current
 * registration flow may have none. Both ways in supply one now: the form
 * proves it with a code, and `scripts/create-account.cjs` requires it and
 * records it verified. The unique index tolerates the nulls that remain
 * because Postgres does not consider two of them equal.
 *
 * There is no `pending` status. There used to be, covering the gap between
 * filling in the registration form and clicking the link that arrived
 * afterwards — a gap that no longer exists now that the address is proved
 * before the row is written. An account is either able to act or stopped.
 */
export const accountStatuses = ["active", "suspended"] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export const accountSources = ["bootstrap", "registration"] as const;
export type AccountSource = (typeof accountSources)[number];

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

    source: text("source")
      .$type<AccountSource>()
      .notNull()
      .default("registration"),
    status: text("status").$type<AccountStatus>().notNull().default("active"),

    /**
     * Suspension is data rather than a line in the repository: banning a spam
     * signup should not require a pull request. It is still an accountable
     * act, hence the audit columns.
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedBy: text("suspended_by"),
    suspendedReason: text("suspended_reason"),

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
  ],
);

/**
 * The one thing that genuinely cannot live in Git.
 *
 * A row here means "this handle has been given a way to log in on this
 * deployment". It carries no identity of its own — that is what `accounts` is
 * for — which is why the module in `lib/auth/credentials.ts` deals only in
 * handles and hashes.
 *
 * `passwordHash` is nullable because an account can exist, and a setup code be
 * issued against it, before anyone has chosen a password.
 */
export const credentials = pgTable("credentials", {
  handle: text("handle")
    .primaryKey()
    .references(() => accounts.handle, { onDelete: "cascade" }),
  passwordHash: text("password_hash"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Single-use, hashed, expiring secrets mailed to the owner of an account.
 *
 * Down to one purpose, and kept as a `purpose` column anyway. Two have been
 * retired: `setup_code`, a credential an administrator handed over in person,
 * and `email_verify`, whose link has been replaced by a code checked before
 * the account exists — which is precisely why it could not stay here, since
 * `handle` below presumes an account to point at. The column costs a text
 * field and is what makes the next one an insert rather than a migration.
 *
 * Only the digest is stored. A row is consumed rather than deleted so that
 * "this link has already been used" stays distinguishable from "this link
 * never existed", and so that a recently issued token can throttle the next
 * request for one without a separate rate-limit store.
 */
export const tokenPurposes = ["password_reset"] as const;
export type TokenPurpose = (typeof tokenPurposes)[number];

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
   * given in `lib/auth/tokens.ts`: the row recording the send is the row
   * recording when. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The problems somebody has submitted to.
 *
 * Not a mirror of `content/problems`, though it was one for a while: startup
 * pushed the whole registry in, and the only thing that consumed the result
 * was a console finding reporting that the push had not happened yet. Rows are
 * written by `ensureProblem` at the moment a submission first needs the
 * foreign key, so what accumulates here is a normalised index of every problem
 * this deployment has ever judged — including ones since deleted from the
 * repository, which is what keeps their submissions attributable.
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
     * It was `cascade`, which meant tidying up one such row would have taken
     * every submission to that problem with it.
     */
    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "restrict" }),
    contestSlug: text("contest_slug").references(() => contests.slug, {
      onDelete: "set null",
    }),

    /** Whatever the statement's submitter produced. Never read by the kernel. */
    payload: jsonb("payload").$type<unknown>().notNull(),

    state: text("state").$type<SubmissionState>().notNull().default("pending"),

    /**
     * Whatever the backend returned, verbatim.
     *
     * The mirror image of `payload`, and it took a while to become one. It
     * carried a schema the kernel read fields out of at every call site, which
     * made a message from an extension point into a domain object: the same
     * number was reachable as `verdict.score` and as the column below, with
     * nothing saying which was authoritative. Now the callback parses it once
     * and the columns below are what the kernel kept; this is the audit copy,
     * and only a problem's own components look inside it — see `detail` in
     * `lib/backend/types.ts`.
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
     * `VERDICT_PRESETS` translates the ones FOI ships with and anything else
     * renders as itself.
     */
    outcome: text("outcome"),

    /**
     * What judged this, and against what.
     *
     * A verdict is only reproducible if both ends are pinned. `releaseSha` is
     * the commit this kernel was built from, which fixes the problem's entire
     * definition because `content/` lives in the same repository — Polygon had
     * to build per-problem revisions to get the same guarantee. `backendVersion`
     * is what the backend said about itself, and it covers the half that is not
     * in this repository at all: the testdata, the checker, the judging code.
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

    /** Judge-side handle, used by the reconciler to poll for a lost callback. */
    judgeRef: text("judge_ref"),
    /**
     * Which backend this went to. The column keeps its original name: renaming
     * the concept is a source change, and a migration that rewrites a column
     * only to spell it differently is downtime bought for nothing.
     */
    backendId: text("judge_id").notNull(),
    callbackTokenHash: text("callback_token_hash").notNull(),

    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (table) => [
    index("submissions_standings_idx").on(
      table.contestSlug,
      table.problemSlug,
      table.handle,
      table.createdAt,
    ),
    // Drives the reconciler sweep for submissions whose callback never landed.
    index("submissions_pending_idx").on(table.state, table.createdAt),
    index("submissions_handle_idx").on(table.handle, table.createdAt),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type AuthTokenRow = typeof authTokens.$inferSelect;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;

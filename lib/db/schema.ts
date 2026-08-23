import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SubmissionState, Verdict } from "@/lib/judge/types";

/**
 * The database holds three kinds of thing and nothing else:
 *
 *   1. secrets and personal data, which cannot be committed — `accounts`
 *      (the email address), `credentials`, `auth_tokens`
 *   2. mirrors of the filesystem registries, which exist only so that
 *      submissions can carry foreign keys — `problems`, `contests`
 *   3. things that actually happened — `submissions`, and every row in
 *      `accounts` that came from someone filling in the registration form
 *
 * What is deliberately absent is any column an administrator would want to
 * edit in order to change what somebody may do. Roles and cohort tags are not
 * stored: `content/enrollment/` declares the rules that produce them and
 * `lib/auth/policy.ts` declares what each role means, so a privilege change is
 * a reviewed commit rather than an UPDATE nobody can find afterwards.
 */

/**
 * Who exists.
 *
 * Almost every row here is created by the registration form, which is why the
 * table holds no authority of its own: `handle`, `displayName` and `email` say
 * who someone claims to be, and `status` says whether they may act at all. The
 * answer to "what may they do" is computed in `lib/accounts/resolve.ts` from
 * the email address and the grants in `content/enrollment/`, and is never
 * written back — see the note on tags there.
 *
 * `email` is null only for bootstrap accounts, which are declared in the
 * repository and given a password over the CLI. The unique index tolerates
 * that because Postgres does not consider two nulls equal.
 */
export const accountStatuses = ["pending", "active", "suspended"] as const;
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
    status: text("status").$type<AccountStatus>().notNull().default("pending"),

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
 * Single-use, hashed, expiring secrets sent to an email address.
 *
 * Verifying a new address, recovering a password and the
 * administrator-issued setup code are the same mechanism with different
 * consequences, so they are one table with a `purpose` rather than three pairs
 * of nullable columns on `credentials` — which is where the setup code used to
 * live, and which could only ever hold one outstanding code.
 *
 * Only the digest is stored. A row is consumed rather than deleted so that
 * "this link has already been used" stays distinguishable from "this link
 * never existed", and so that a recently issued token can throttle the next
 * request for one without a separate rate-limit store.
 */
export const tokenPurposes = [
  "setup_code",
  "email_verify",
  "password_reset",
] as const;
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
 * Mirror of the filesystem registry. `content/problems` remains the source of
 * truth; this table exists so submissions can carry a foreign key and so
 * listings can join without reading the registry.
 */
export const problems = pgTable("problems", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  maxScore: doublePrecision("max_score").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Mirror of `content/contests`, for the same reason as above and no other.
 * Schedule, problem set and entry rules are all in the registry — this table
 * is a foreign key anchor, which is why it has no `starts_at`.
 *
 * Sync never deletes: a contest removed from the repository keeps its row so
 * that submissions made during it stay attributable. `/admin` reports the
 * orphan instead of the sync silently detaching history.
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

    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "cascade" }),
    contestSlug: text("contest_slug").references(() => contests.slug, {
      onDelete: "set null",
    }),

    /** Whatever the statement's submitter produced. Never read by the kernel. */
    payload: jsonb("payload").$type<unknown>().notNull(),

    state: text("state").$type<SubmissionState>().notNull().default("pending"),

    /** Full judge result. `score`/`maxScore` below are denormalised from it. */
    verdict: jsonb("verdict").$type<Verdict>(),
    score: doublePrecision("score"),
    maxScore: doublePrecision("max_score"),

    /** Judge-side handle, used by the reconciler to poll for a lost callback. */
    judgeRef: text("judge_ref"),
    judgeId: text("judge_id").notNull(),
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
export type CredentialRow = typeof credentials.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;

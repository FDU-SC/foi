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

export type AccountStatus = "active" | "suspended";

export type SuspensionAction = "suspend" | "reinstate";

export const accounts = pgTable(
  "accounts",
  {
    handle: text("handle").primaryKey(),
    displayName: text("display_name").notNull(),

    email: text("email"),

    passwordHash: text("password_hash"),
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),

    status: text("status").$type<AccountStatus>().notNull().default("active"),

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

    check(
      "accounts_password_pair_ck",
      sql`(${table.passwordHash} is null) = (${table.passwordSetAt} is null)`,
    ),
  ],
);

const { passwordHash: _passwordHash, ...accountColumnsWithoutHash } =
  getTableColumns(accounts);

export const accountColumns = accountColumnsWithoutHash;

export const accountSuspensions = pgTable(
  "account_suspensions",
  {
    id: text("id").primaryKey(),
    handle: text("handle")
      .notNull()
      .references(() => accounts.handle, { onDelete: "cascade" }),
    action: text("action").$type<SuspensionAction>().notNull(),
    performedBy: text("performed_by").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_suspensions_handle_idx").on(table.handle, table.createdAt),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    handle: text("handle")
      .notNull()
      .references(() => accounts.handle, { onDelete: "cascade" }),

    tokenHash: text("token_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_key").on(table.tokenHash),
    index("password_reset_tokens_handle_idx").on(
      table.handle,
      table.createdAt,
    ),
  ],
);

export const emailVerifications = pgTable("email_verifications", {

  email: text("email").primaryKey(),

  codeHash: text("code_hash").notNull(),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  attempts: integer("attempts").notNull().default(0),

  verifiedAt: timestamp("verified_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const problems = pgTable("problems", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

    handle: text("handle")
      .notNull()
      .references(() => accounts.handle, { onDelete: "restrict" }),

    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "restrict" }),
    contestSlug: text("contest_slug").references(() => contests.slug, {
      onDelete: "set null",
    }),

    payload: jsonb("payload").$type<unknown>().notNull(),

    clientNonce: text("client_nonce"),

    state: text("state").$type<SubmissionState>().notNull().default("queued"),

    verdict: jsonb("verdict").$type<Verdict>(),

    score: doublePrecision("score"),

    maxScore: doublePrecision("max_score"),

    accepted: boolean("accepted"),

    outcome: text("outcome"),

    releaseSha: text("release_sha"),
    backendVersion: text("backend_version"),

    backendId: text("backend_id").notNull(),

    attempts: integer("attempts").notNull().default(0),

    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (table) => [
    index("submissions_standings_idx").on(
      table.contestSlug,
      table.problemSlug,
      table.handle,
      table.createdAt,
    ),

    index("submissions_queued_idx")
      .on(table.backendId, table.queuedAt)
      .where(sql`state = 'queued'`),

    index("submissions_disrupted_idx")
      .on(table.judgedAt)
      .where(sql`state = 'disrupted'`),
    index("submissions_handle_idx").on(table.handle, table.createdAt),

    uniqueIndex("submissions_client_nonce_key").on(
      table.handle,
      table.clientNonce,
    ),
  ],
);

export const judgingSessions = pgTable(
  "judging_sessions",
  {
    submissionId: text("submission_id")
      .primaryKey()
      .references(() => submissions.id, { onDelete: "cascade" }),
    runnerId: text("runner_id").notNull(),
    lease: text("lease"),
    runnerStatus: text("runner_status"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("judging_sessions_lapsed_idx")
      .on(table.lastHeartbeatAt)
      .where(sql`lease is not null`),
  ],
);

export const runners = pgTable(
  "runners",
  {
    backendId: text("backend_id").notNull(),

    runnerId: text("runner_id").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [

    primaryKey({ columns: [table.backendId, table.runnerId] }),
  ],
);

export type AccountRow = Omit<typeof accounts.$inferSelect, "passwordHash">;
export type AccountSuspensionRow = typeof accountSuspensions.$inferSelect;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type JudgingSessionRow = typeof judgingSessions.$inferSelect;
export type RunnerRow = typeof runners.$inferSelect;

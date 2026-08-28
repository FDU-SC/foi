import { getTableColumns, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type AccountStatus = "active" | "suspended";

export type SuspensionAction = "suspend" | "reinstate";

export type SubmissionRecordState = "pending" | "completed" | "disrupted";

export type QueueState = "waiting" | "claimed";

export type AttemptOutcome = "completed" | "failed" | "expired";

export const accounts = pgTable(
  "accounts",
  {
    uid: integer("uid").primaryKey().generatedAlwaysAsIdentity(),
    username: text("username").notNull(),
    usernameChangedAt: timestamp("username_changed_at", { withTimezone: true }),
    nickname: text("nickname").notNull(),

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
    uniqueIndex("accounts_username_key").on(sql`lower(${table.username})`),
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
    uid: integer("uid")
      .notNull()
      .references(() => accounts.uid, { onDelete: "cascade" }),
    action: text("action").$type<SuspensionAction>().notNull(),
    performedBy: integer("performed_by").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_suspensions_uid_idx").on(table.uid, table.createdAt),
  ],
);



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

    uid: integer("uid")
      .notNull()
      .references(() => accounts.uid, { onDelete: "restrict" }),

    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "restrict" }),
    contestSlug: text("contest_slug").references(() => contests.slug, {
      onDelete: "set null",
    }),

    payload: jsonb("payload").$type<unknown>().notNull(),

    clientNonce: text("client_nonce"),

    backendId: text("backend_id").notNull(),

    releaseSha: text("release_sha"),

    state: text("state")
      .$type<SubmissionRecordState>()
      .notNull()
      .default("pending"),

    result: jsonb("result").$type<Record<string, unknown>>(),

    detail: jsonb("detail").$type<unknown>(),

    backendVersion: text("backend_version"),

    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    judgedAt: timestamp("judged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("submissions_nonce_key")
      .on(table.uid, table.clientNonce)
      .where(sql`${table.clientNonce} is not null`),

    index("submissions_standings_idx").on(
      table.contestSlug,
      table.problemSlug,
      table.uid,
      table.createdAt,
    ),

    index("submissions_user_idx").on(table.uid, table.createdAt),

    check(
      "submissions_state_ck",
      sql`${table.state} in ('pending', 'completed', 'disrupted')`,
    ),
  ],
);

export const judgingQueue = pgTable(
  "judging_queue",
  {
    submissionId: text("submission_id")
      .primaryKey()
      .references(() => submissions.id, { onDelete: "cascade" }),

    backendId: text("backend_id").notNull(),

    priority: smallint("priority").notNull().default(0),

    state: text("state").$type<QueueState>().notNull().default("waiting"),

    attempts: integer("attempts").notNull().default(0),

    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    runnerId: text("runner_id"),
    lease: text("lease"),
    runnerStatus: text("runner_status"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (table) => [
    index("judging_queue_dispatch_idx")
      .on(table.backendId, table.priority, table.queuedAt)
      .where(sql`${table.state} = 'waiting'`),

    index("judging_queue_reaper_idx")
      .on(table.heartbeatAt)
      .where(sql`${table.state} = 'claimed'`),

    check(
      "judging_queue_state_ck",
      sql`${table.state} in ('waiting', 'claimed')`,
    ),
  ],
);

export const judgingAttempts = pgTable(
  "judging_attempts",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),

    backendId: text("backend_id").notNull(),
    runnerId: text("runner_id").notNull(),

    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").$type<AttemptOutcome>(),
    lastStatus: text("last_status"),
    error: text("error"),
  },
  (table) => [
    index("judging_attempts_submission_idx").on(
      table.submissionId,
      table.claimedAt,
    ),

    check(
      "judging_attempts_outcome_ck",
      sql`${table.outcome} is null or ${table.outcome} in ('completed', 'failed', 'expired')`,
    ),
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
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type JudgingQueueRow = typeof judgingQueue.$inferSelect;
export type JudgingAttemptRow = typeof judgingAttempts.$inferSelect;
export type RunnerRow = typeof runners.$inferSelect;

import {
  boolean,
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
import type { SubmissionState, Verdict } from "@/lib/judge/types";
import type { UserRole } from "@/lib/auth/session";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<UserRole>().notNull().default("user"),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_handle_key").on(table.handle)],
);

/**
 * Mirror of the filesystem registry. `content/problems` remains the source of
 * truth; this table exists so submissions can carry a foreign key and so
 * standings queries can join without reading the registry.
 */
export const problems = pgTable("problems", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  maxScore: doublePrecision("max_score").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contests = pgTable(
  "contests",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    rulesetId: text("ruleset_id").notNull(),
    rulesetConfig: jsonb("ruleset_config").$type<unknown>(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    freezeAt: timestamp("freeze_at", { withTimezone: true }),
    visible: boolean("visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("contests_slug_key").on(table.slug)],
);

export const contestProblems = pgTable(
  "contest_problems",
  {
    contestId: text("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "cascade" }),
    label: text("label").notNull(),
    points: doublePrecision("points"),
    /** Per-contest overrides handed to the ruleset. Opaque to the kernel. */
    config: jsonb("config").$type<unknown>(),
    order: integer("order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.contestId, table.problemSlug] }),
    index("contest_problems_contest_idx").on(table.contestId, table.order),
  ],
);

export const contestParticipants = pgTable(
  "contest_participants",
  {
    contestId: text("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Excluded from standings but still able to submit. */
    unofficial: boolean("unofficial").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.contestId, table.userId] })],
);

export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemSlug: text("problem_slug")
      .notNull()
      .references(() => problems.slug, { onDelete: "cascade" }),
    contestId: text("contest_id").references(() => contests.id, {
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
      table.contestId,
      table.problemSlug,
      table.userId,
      table.createdAt,
    ),
    // Drives the reconciler sweep for submissions whose callback never landed.
    index("submissions_pending_idx").on(table.state, table.createdAt),
    index("submissions_user_idx").on(table.userId, table.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type ContestProblemRow = typeof contestProblems.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;

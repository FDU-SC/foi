import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { SubmissionState, Verdict } from "@/lib/judge/types";

/**
 * The database holds three kinds of thing and nothing else:
 *
 *   1. secrets, which cannot be committed — `credentials`
 *   2. mirrors of the filesystem registries, which exist only so that
 *      submissions can carry foreign keys — `problems`, `contests`
 *   3. things that actually happened — `submissions`
 *
 * Anything declarative — who exists, what they may do, which problems are in
 * which contest — lives in `content/` and `lib/auth/policy.ts` instead, where
 * it is typed, reviewable and versioned. If you find yourself adding a column
 * an administrator would want to edit, it probably belongs in the repository.
 */

/**
 * The one thing that genuinely cannot live in Git.
 *
 * A row here means "this handle has been issued something to log in with on
 * this deployment". Identity, role and display name are not stored: they come
 * from `content/roster/`, so a row is only ever a secret plus its metadata.
 *
 * `passwordHash` is nullable because a setup code can be issued before the
 * person has chosen a password.
 */
export const credentials = pgTable("credentials", {
  /** Lowercased handle. `normalizeHandle` in the roster registry does this. */
  handle: text("handle").primaryKey(),
  passwordHash: text("password_hash"),

  /** SHA-256 of a single-use code that lets its holder set a password. */
  setupCodeHash: text("setup_code_hash"),
  setupExpiresAt: timestamp("setup_expires_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
     * clearing someone's credentials should not quietly erase what they did.
     */
    handle: text("handle")
      .notNull()
      .references(() => credentials.handle, { onDelete: "restrict" }),

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

export type CredentialRow = typeof credentials.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type ContestRow = typeof contests.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;

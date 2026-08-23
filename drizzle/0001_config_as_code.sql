-- Moves configuration out of the database and into the repository.
--
-- The generated skeleton was rewritten by hand for two reasons: it dropped
-- `users` before anything could read the password hashes out of it, and it
-- added the new `contests` primary key while the old one was still in place.
-- Everything below is ordered so that data is carried across before the
-- structure it came from is removed.
--
-- Handles are lowercased on the way in. The roster registry looks members up
-- case-insensitively, so the database keeps a single canonical form.

CREATE TABLE "credentials" (
	"handle" text PRIMARY KEY NOT NULL,
	"password_hash" text,
	"setup_code_hash" text,
	"setup_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Identity, role and display name are deliberately left behind: they now come
-- from content/roster/. Only the secret survives the move.
INSERT INTO "credentials" ("handle", "password_hash", "created_at", "updated_at")
SELECT DISTINCT ON (lower(u."handle"))
	lower(u."handle"), u."password_hash", u."created_at", now()
FROM "users" u
ORDER BY lower(u."handle"), u."created_at" ASC;
--> statement-breakpoint

ALTER TABLE "submissions" ADD COLUMN "handle" text;--> statement-breakpoint

UPDATE "submissions" s
SET "handle" = lower(u."handle")
FROM "users" u
WHERE u."id" = s."user_id";
--> statement-breakpoint

-- Only reachable when two accounts differed solely in case, in which case the
-- loser of the DISTINCT ON above has no credentials row yet. Give it one with
-- no password so its submissions keep a valid owner; the roster decides
-- whether the handle still means anything.
INSERT INTO "credentials" ("handle")
SELECT DISTINCT s."handle" FROM "submissions" s WHERE s."handle" IS NOT NULL
ON CONFLICT ("handle") DO NOTHING;
--> statement-breakpoint

-- Fails the whole migration if any submission lost its owner, rather than
-- letting the deploy continue against half-migrated data.
ALTER TABLE "submissions" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "submissions" ADD COLUMN "contest_slug" text;--> statement-breakpoint

UPDATE "submissions" s
SET "contest_slug" = c."slug"
FROM "contests" c
WHERE c."id" = s."contest_id";
--> statement-breakpoint

ALTER TABLE "submissions" DROP CONSTRAINT "submissions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_contest_id_contests_id_fk";--> statement-breakpoint
DROP INDEX "submissions_user_idx";--> statement-breakpoint
DROP INDEX "submissions_standings_idx";--> statement-breakpoint

-- Both join tables are pure configuration and are now expressed in the
-- contest file. They have to go before the contests primary key can move,
-- because their foreign keys are what hold contests_pkey in place.
DROP TABLE "contest_participants" CASCADE;--> statement-breakpoint
DROP TABLE "contest_problems" CASCADE;--> statement-breakpoint
DROP TABLE "users" CASCADE;--> statement-breakpoint

-- contests keeps only what a foreign key needs. Schedule, ruleset and problem
-- set all live in content/contests/<slug>/contest.ts now.
DROP INDEX "contests_slug_key";--> statement-breakpoint
ALTER TABLE "contests" DROP CONSTRAINT "contests_pkey";--> statement-breakpoint
ALTER TABLE "contests" ADD PRIMARY KEY ("slug");--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "ruleset_id";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "ruleset_config";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "starts_at";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "ends_at";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "freeze_at";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "visible";--> statement-breakpoint
ALTER TABLE "contests" DROP COLUMN "created_at";--> statement-breakpoint

ALTER TABLE "submissions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "submissions" DROP COLUMN "contest_id";--> statement-breakpoint

-- Restrict, not cascade: a submission is an audit record and should outlive
-- any decision to clear someone's credentials.
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_handle_credentials_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."credentials"("handle") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contest_slug_contests_slug_fk" FOREIGN KEY ("contest_slug") REFERENCES "public"."contests"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_handle_idx" ON "submissions" USING btree ("handle","created_at");--> statement-breakpoint
CREATE INDEX "submissions_standings_idx" ON "submissions" USING btree ("contest_slug","problem_slug","handle","created_at");

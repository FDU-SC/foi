-- Gives people a row of their own.
--
-- Until now `credentials` doubled as the list of everyone the deployment knew
-- about, because identity lived in content/roster/ and only the password had
-- to be stored. Self-service registration ends that: someone who signs up has
-- no repository entry to be identified by, and their email address is both the
-- thing that identifies them and the thing that decides which cohort tags they
-- resolve to. Neither belongs in Git.
--
-- Written by hand rather than generated. The generator drops the setup-code
-- columns before anything can copy the outstanding codes out of them, and it
-- re-points the submissions foreign key before `accounts` has any rows for it
-- to point at. Everything below is ordered so that data is carried across
-- before the structure it came from is removed.

CREATE TABLE "accounts" (
	"handle" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"source" text DEFAULT 'registration' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_by" text,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Everyone who could log in before this migration was declared in the
-- repository, so they all come across as bootstrap accounts with no email.
-- `display_name` is seeded with the handle because SQL cannot read the
-- registry; `syncGrants()` overwrites it on the next boot, which happens
-- before the first request is served.
INSERT INTO "accounts" ("handle", "display_name", "source", "status", "created_at", "updated_at")
SELECT c."handle", c."handle", 'bootstrap', 'active', c."created_at", now()
FROM "credentials" c;
--> statement-breakpoint

CREATE UNIQUE INDEX "accounts_email_key" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint

CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Outstanding setup codes survive the move, so a code handed out yesterday
-- still works after the deploy. Expired ones come across too and are rejected
-- at redemption exactly as they were before.
INSERT INTO "auth_tokens" ("id", "handle", "purpose", "token_hash", "expires_at", "created_at")
SELECT gen_random_uuid()::text, c."handle", 'setup_code', c."setup_code_hash",
	c."setup_expires_at", c."updated_at"
FROM "credentials" c
WHERE c."setup_code_hash" IS NOT NULL AND c."setup_expires_at" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_handle_accounts_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."accounts"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_handle_idx" ON "auth_tokens" USING btree ("handle","purpose","created_at");--> statement-breakpoint

ALTER TABLE "credentials" DROP COLUMN "setup_code_hash";--> statement-breakpoint
ALTER TABLE "credentials" DROP COLUMN "setup_expires_at";--> statement-breakpoint

-- A password with no account behind it is now unreachable, so the row goes
-- with the account. Submissions are what stops an account being deleted in the
-- first place.
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_handle_accounts_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."accounts"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Submissions belong to a person, not to a password.
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_handle_credentials_handle_fk";--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_handle_accounts_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."accounts"("handle") ON DELETE restrict ON UPDATE no action;

CREATE TABLE "account_suspensions" (
	"id" text PRIMARY KEY NOT NULL,
	"uid" integer NOT NULL,
	"action" text NOT NULL,
	"performed_by" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"uid" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "accounts_uid_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"nickname" text NOT NULL,
	"email" text,
	"password_hash" text,
	"password_set_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_password_pair_ck" CHECK (("accounts"."password_hash" is null) = ("accounts"."password_set_at" is null))
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judging_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "judging_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"submission_id" text NOT NULL,
	"backend_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"last_status" text,
	"error" text,
	CONSTRAINT "judging_attempts_outcome_ck" CHECK ("judging_attempts"."outcome" is null or "judging_attempts"."outcome" in ('completed', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "judging_queue" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"backend_id" text NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"runner_id" text,
	"lease" text,
	"runner_status" text,
	"heartbeat_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "judging_queue_state_ck" CHECK ("judging_queue"."state" in ('waiting', 'claimed'))
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"backend_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_backend_id_runner_id_pk" PRIMARY KEY("backend_id","runner_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"uid" integer NOT NULL,
	"problem_slug" text NOT NULL,
	"contest_slug" text,
	"payload" jsonb NOT NULL,
	"client_nonce" text,
	"backend_id" text NOT NULL,
	"release_sha" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"detail" jsonb,
	"backend_version" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"judged_at" timestamp with time zone,
	CONSTRAINT "submissions_state_ck" CHECK ("submissions"."state" in ('pending', 'completed', 'disrupted'))
);
--> statement-breakpoint
ALTER TABLE "account_suspensions" ADD CONSTRAINT "account_suspensions_uid_accounts_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."accounts"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_attempts" ADD CONSTRAINT "judging_attempts_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_queue" ADD CONSTRAINT "judging_queue_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_uid_accounts_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."accounts"("uid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_slug_problems_slug_fk" FOREIGN KEY ("problem_slug") REFERENCES "public"."problems"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contest_slug_contests_slug_fk" FOREIGN KEY ("contest_slug") REFERENCES "public"."contests"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_suspensions_uid_idx" ON "account_suspensions" USING btree ("uid","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "judging_attempts_submission_idx" ON "judging_attempts" USING btree ("submission_id","claimed_at");--> statement-breakpoint
CREATE INDEX "judging_queue_dispatch_idx" ON "judging_queue" USING btree ("backend_id","priority","queued_at") WHERE "judging_queue"."state" = 'waiting';--> statement-breakpoint
CREATE INDEX "judging_queue_reaper_idx" ON "judging_queue" USING btree ("heartbeat_at") WHERE "judging_queue"."state" = 'claimed';--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_nonce_key" ON "submissions" USING btree ("uid","client_nonce") WHERE "submissions"."client_nonce" is not null;--> statement-breakpoint
CREATE INDEX "submissions_standings_idx" ON "submissions" USING btree ("contest_slug","problem_slug","uid","created_at");--> statement-breakpoint
CREATE INDEX "submissions_user_idx" ON "submissions" USING btree ("uid","created_at");
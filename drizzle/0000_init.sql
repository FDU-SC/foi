CREATE TABLE "account_suspensions" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"action" text NOT NULL,
	"performed_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"handle" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
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
CREATE TABLE "judging_sessions" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"runner_id" text NOT NULL,
	"lease" text,
	"runner_status" text,
	"last_heartbeat_at" timestamp with time zone,
	"claimed_at" timestamp with time zone NOT NULL
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
	"handle" text NOT NULL,
	"problem_slug" text NOT NULL,
	"contest_slug" text,
	"payload" jsonb NOT NULL,
	"client_nonce" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"verdict" jsonb,
	"score" double precision,
	"max_score" double precision,
	"accepted" boolean,
	"outcome" text,
	"release_sha" text,
	"backend_version" text,
	"backend_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"judged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_suspensions" ADD CONSTRAINT "account_suspensions_handle_accounts_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."accounts"("handle") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_sessions" ADD CONSTRAINT "judging_sessions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_handle_accounts_handle_fk" FOREIGN KEY ("handle") REFERENCES "public"."accounts"("handle") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_slug_problems_slug_fk" FOREIGN KEY ("problem_slug") REFERENCES "public"."problems"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contest_slug_contests_slug_fk" FOREIGN KEY ("contest_slug") REFERENCES "public"."contests"("slug") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_suspensions_handle_idx" ON "account_suspensions" USING btree ("handle","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "judging_sessions_lapsed_idx" ON "judging_sessions" USING btree ("last_heartbeat_at") WHERE lease is not null;--> statement-breakpoint
CREATE INDEX "submissions_standings_idx" ON "submissions" USING btree ("contest_slug","problem_slug","handle","created_at");--> statement-breakpoint
CREATE INDEX "submissions_queued_idx" ON "submissions" USING btree ("backend_id","queued_at") WHERE state = 'queued';--> statement-breakpoint
CREATE INDEX "submissions_disrupted_idx" ON "submissions" USING btree ("judged_at") WHERE state = 'disrupted';--> statement-breakpoint
CREATE INDEX "submissions_handle_idx" ON "submissions" USING btree ("handle","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_client_nonce_key" ON "submissions" USING btree ("handle","client_nonce");
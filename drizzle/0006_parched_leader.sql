CREATE TABLE "problem_contests" (
	"problem_slug" text NOT NULL,
	"contest_slug" text NOT NULL,
	"label" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "problem_contests_problem_slug_contest_slug_pk" PRIMARY KEY("problem_slug","contest_slug")
);
--> statement-breakpoint
CREATE TABLE "problem_files" (
	"problem_slug" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"encoding" text,
	"size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problem_files_problem_slug_path_pk" PRIMARY KEY("problem_slug","path"),
	CONSTRAINT "problem_files_encoding_ck" CHECK ("problem_files"."encoding" is null or "problem_files"."encoding" = 'base64')
);
--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "statement_mdx" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "max_score" integer;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "backend_id" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "ui" jsonb;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "views_preset" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "views_params" jsonb;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "problem_contests" ADD CONSTRAINT "problem_contests_problem_slug_problems_slug_fk" FOREIGN KEY ("problem_slug") REFERENCES "public"."problems"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_contests" ADD CONSTRAINT "problem_contests_contest_slug_contests_slug_fk" FOREIGN KEY ("contest_slug") REFERENCES "public"."contests"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_files" ADD CONSTRAINT "problem_files_problem_slug_problems_slug_fk" FOREIGN KEY ("problem_slug") REFERENCES "public"."problems"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_contests_contest_idx" ON "problem_contests" USING btree ("contest_slug","position");--> statement-breakpoint
CREATE INDEX "problems_status_idx" ON "problems" USING btree ("status");--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_status_ck" CHECK ("problems"."status" is null or "problems"."status" in ('draft', 'published'));
CREATE TABLE "runner_tokens" (
	"key_id" text PRIMARY KEY NOT NULL,
	"backend_id" text NOT NULL,
	"label" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_by" integer,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "runner_tokens_backend_idx" ON "runner_tokens" USING btree ("backend_id","created_at");
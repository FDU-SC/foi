DROP INDEX "submissions_queued_idx";--> statement-breakpoint
CREATE INDEX "submissions_queued_idx" ON "submissions" USING btree ("judge_id","queued_at") WHERE state = 'queued';
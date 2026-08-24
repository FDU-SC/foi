-- What the kernel keeps out of a judge's reply, and one foreign key that was
-- pointed the wrong way.
--
-- A verdict is a message from an extension point: everything but its status
-- label is optional now, and the shape of the rest is the problem author's
-- business. So the four values the kernel actually uses are resolved when the
-- callback lands and kept in columns; `verdict` stays as the audit copy.

ALTER TABLE "submissions" ADD COLUMN "accepted" boolean;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "outcome" text;--> statement-breakpoint

-- `outcome` is a rename in disguise, so it backfills. `accepted` deliberately
-- does not: it holds only what a backend declared, and no backend could have
-- declared anything before this migration. Null is the honest value, and
-- `isAccepted` derives an answer from the score for every row that has one.
UPDATE "submissions" SET "outcome" = "verdict"->>'status'
WHERE "verdict" IS NOT NULL;--> statement-breakpoint

-- Was `cascade`. `problems` holds a row for every problem ever submitted to,
-- including ones since deleted from the repository, and `/admin` lists those
-- precisely because their submissions are still here. Tidying one away would
-- have taken the submissions with it — the same argument the `handle` foreign
-- key already made for accounts.
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_problem_slug_problems_slug_fk";--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_slug_problems_slug_fk" FOREIGN KEY ("problem_slug") REFERENCES "public"."problems"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Never read. A submission's denominator is its own `max_score`, resolved from
-- the verdict or the configuration at the moment it was judged; the current
-- configuration is in `content/problems/`.
ALTER TABLE "problems" DROP COLUMN "max_score";

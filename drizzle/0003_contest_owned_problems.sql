-- A problem is reachable only as part of a contest, so every submission is
-- attributed to one. Rows predating that rule have no contest to move to, and
-- guessing one would put work on a leaderboard nobody submitted it to. Refuse
-- instead, and let an operator decide what those rows were.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "submissions" WHERE "contest_slug" IS NULL) THEN
		RAISE EXCEPTION '存在 contest_slug 为空的提交（旧的练习提交），无法把该列改为 NOT NULL。请先删除或改归到某场比赛，再重新运行迁移。';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_contest_slug_contests_slug_fk";
--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "contest_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contest_slug_contests_slug_fk" FOREIGN KEY ("contest_slug") REFERENCES "public"."contests"("slug") ON DELETE restrict ON UPDATE no action;

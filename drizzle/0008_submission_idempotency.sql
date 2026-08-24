-- The one step of the judging loop that was not idempotent: the entrance.
--
-- Everything downstream already tolerates being told twice — the callback token
-- is single-use, the state guards make the first verdict win, `ensureProblem`
-- upserts. Only the submit endpoint answered a repeat by doing the work again,
-- and what that costs is a second row and a second slot in a judge's queue for
-- one thing the player did once.
--
-- Nullable, and nothing backfills, because there is nothing to backfill to:
-- rows written before this carried no nonce, and inventing one would make them
-- look as though they had. It costs nothing either, since Postgres holds no two
-- nulls to be equal — every existing row, and every future submission from a
-- client that sends no nonce, is invisible to the index below.
--
-- Unique on `(handle, client_nonce)` rather than on the nonce alone: it is a
-- client's private counter, so a global key would let one person's value
-- collide with another person's submission.

ALTER TABLE "submissions" ADD COLUMN "client_nonce" text;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_client_nonce_key" ON "submissions" USING btree ("handle","client_nonce");

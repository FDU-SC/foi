-- What judged a submission, and against what.
--
-- A verdict only means something if both ends are pinned. `release_sha` is the
-- commit this kernel was built from, which fixes every problem's definition
-- because `content/` is in the same repository. `backend_version` is what the
-- backend said about itself, covering the half that is not in this repository
-- at all: testdata, checker, judging code.
--
-- Neither backfills. `backend_version` is required by the protocol from now on,
-- but rows written before it existed genuinely have no answer and inventing one
-- would defeat the point of recording it.

ALTER TABLE "submissions" ADD COLUMN "release_sha" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "backend_version" text;

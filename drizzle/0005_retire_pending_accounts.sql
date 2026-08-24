-- Retires the half-made account.
--
-- `pending` existed for the gap between submitting the registration form and
-- clicking the link that arrived afterwards. Proving the address first closes
-- that gap: nothing is written until the code has been typed back, and what is
-- written is already active. No code path can produce a `pending` row any more,
-- so leaving the state in place would leave a status nothing sets, a sweep that
-- finds nothing, and a badge in `/admin` that is always absent.
--
-- Existing rows are deleted rather than promoted. Every one of them is a signup
-- that never proved its address and never could log in — `resolveFromRow` marks
-- anything other than `active` disabled — and every one was already scheduled to
-- be swept within the day by the job this migration removes. Deleting them now
-- is that sweep, run once, early.
DELETE FROM "accounts"
WHERE "status" = 'pending'
  AND "source" = 'registration'
  AND NOT EXISTS (
    SELECT 1 FROM "submissions" WHERE "submissions"."handle" = "accounts"."handle"
  );
--> statement-breakpoint

-- Whatever is left is not a stalled signup: either a bootstrap account declared
-- in the repository, which exists because a reviewed file says so, or a row that
-- has submissions and therefore was in use. Both belong in `active`.
UPDATE "accounts" SET "status" = 'active' WHERE "status" = 'pending';
--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint

-- Pinned where the data lives, for the same reason 0003 pinned the token
-- purposes: the set of statuses was only ever enforced in TypeScript, which is
-- no help to the next person writing SQL by hand.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_status_check"
  CHECK ("status" IN ('active', 'suspended'));
--> statement-breakpoint

-- The verification link is gone with the state it used to produce. Its
-- replacement could not live in this table at all: `handle` is NOT NULL and
-- references `accounts`, and the whole point of verifying first is that there
-- is no account yet to point at. See `email_verifications`.
DELETE FROM "auth_tokens" WHERE "purpose" = 'email_verify';
--> statement-breakpoint

ALTER TABLE "auth_tokens" DROP CONSTRAINT IF EXISTS "auth_tokens_purpose_check";
--> statement-breakpoint

ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_purpose_check"
  CHECK ("purpose" IN ('password_reset'));

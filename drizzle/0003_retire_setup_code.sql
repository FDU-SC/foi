-- Retires the administrator-issued setup code.
--
-- Self-service registration covers first-time access and the emailed reset
-- covers recovery, so the only job left for a setup code was handing a
-- credential to somebody in person — which is precisely the part worth
-- removing: it put a secret capable of taking over an account into a chat log,
-- with no way to notice it had gone to the wrong person.
--
-- Outstanding codes are deleted rather than consumed. Nothing can redeem them
-- any more, so a consumed row would only be a record of a mechanism that no
-- longer exists; anyone mid-flight uses the reset link instead.
DELETE FROM "auth_tokens" WHERE "purpose" = 'setup_code';
--> statement-breakpoint

-- The set of purposes was only ever enforced in TypeScript, which does not
-- help the next person writing SQL by hand. Now that it is down to two, pin it
-- where the data lives.
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_purpose_check"
  CHECK ("purpose" IN ('email_verify', 'password_reset'));

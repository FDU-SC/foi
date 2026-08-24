-- Proof of address, established before the account exists.
--
-- Registration used to create the account first and mail a link that activated
-- it. Turning that around — verify, then create — means the proof has nowhere
-- to hang: `auth_tokens.handle` is NOT NULL and references `accounts`, so it
-- presumes exactly what has not happened yet. Hence a table keyed by the
-- address, one row per mailbox in flight.
--
-- `attempts` is what a six-digit code needs and a 160-bit token does not. The
-- digest is not a lookup key here — the row is found by address and the code
-- only ever compared — so the cap is what stands between a million-wide space
-- and someone working through it.
CREATE TABLE "email_verifications" (
	"email" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

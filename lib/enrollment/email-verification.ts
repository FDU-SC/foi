import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/accounts/queries";
import { db } from "@/lib/db";
import { emailVerifications } from "@/lib/db/schema";

/**
 * The short code that proves someone can read the address they typed.
 *
 * This is the sibling of `lib/accounts/tokens.ts` and deliberately not part of it.
 * A token there is 160 bits, belongs to an account, and travels as a link; a
 * code here is six digits, belongs to an address that may never become an
 * account, and is retyped by hand. Those differences change every decision, so
 * they are two modules rather than one with branches.
 *
 * The numbers below are security parameters rather than deployment policy,
 * which is why they are here and not in `content/enrollment/`. A deployment
 * choosing its own attempt cap is choosing how easily a six-digit code can be
 * guessed, and that is not a knob worth offering.
 */
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * How long a proven address stays proven. The code's own deadline is short
 * because a code in flight is a code that can be guessed; once it has been
 * spent, what remains is the wait for someone to finish choosing a username
 * and a password, which is a different and more forgiving thing.
 */
const VERIFIED_TTL_MS = 30 * 60 * 1000;

/**
 * How soon one *mailbox* may be sent another verification code.
 *
 * `lib/mail/notify.ts` holds a constant of the same name and the same value,
 * and they are deliberately two policies rather than one that got copied.
 * This one is keyed by address and enforced as a condition on the upsert
 * below, because before an account exists an address is the only thing there
 * is to count against. That one is keyed by handle and purpose and derived
 * from the last row in `auth_tokens`, because a reset link is minted against
 * an account. Different subject, different table, different mechanism —
 * folding them into one export would be a claim that this deployment has a
 * single resend policy, which is an assertion somebody would have to own, not
 * a duplicate somebody forgot to remove.
 *
 * Exported as `resendCooldownMs` all the same, so the register form's countdown
 * is tied to the interval it is counting rather than to a literal 60.
 */
const RESEND_COOLDOWN_MS = 60_000;

/**
 * Six digits is a space of a million, so the cap is what makes the code safe
 * rather than the code's own length. Five is enough that a mistyped digit does
 * not cost a round trip through the mail, and far too few to work through the
 * space before the cooldown makes a new code cheaper than another guess.
 */
const MAX_ATTEMPTS = 5;

const CODE_DIGITS = 6;

/**
 * Read at call time, not at import, so the module loads in a process that has
 * not been handed a secret yet — the same reason `lib/enrollment/registration-proof.ts`
 * does it this way. `assertEnv` requires the variable, so a boot that got here
 * without one is a boot that should not have happened.
 */
function pepper(): string {
  return process.env.AUTH_SECRET!;
}

/**
 * The address is inside the digest, so a code mailed to one mailbox cannot be
 * replayed against another. Without it a person who can receive mail anywhere
 * could request a code for their own address and offer it for someone else's.
 *
 * Keyed rather than bare, which is what the six digits make necessary. The
 * whole space is a million, so a plain hash of `address:code` is a preimage
 * anybody holding a dump of this table can find in under a second — for every
 * row at once, and the row also carries the address the code was mailed to.
 * The neighbouring `lib/accounts/tokens.ts` can afford `createHash` because 160
 * bits of randomness has nothing to grind against; this cannot. With the
 * secret mixed in, reading the table is no longer enough to recover a code.
 */
function digest(email: string, code: string): string {
  return createHmac("sha256", pepper()).update(`${email}:${code}`).digest("hex");
}

function matches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Uniform over 000000–999999. `randomInt` rejection-samples; `%` would not. */
function mintCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

export type IssueCodeResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "throttled"; retryAfterMs: number };

/**
 * Mints a code for an address, replacing whatever was outstanding for it.
 *
 * The cooldown is a condition on the upsert rather than a read followed by a
 * write, so two requests arriving together cannot both decide they are the
 * first. Losing that race is indistinguishable from being early, which is
 * exactly what the caller should say either way.
 *
 * A row that had already been verified is reset. Asking for a new code is
 * asking to start over, and leaving the old proof standing would mean a code
 * sent to an address could be sidestepped by one sent a minute earlier.
 */
export async function issueCode(email: string): Promise<IssueCodeResult> {
  const code = mintCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  const [row] = await db
    .insert(emailVerifications)
    .values({
      email,
      codeHash: digest(email, code),
      expiresAt,
      attempts: 0,
      verifiedAt: null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: emailVerifications.email,
      set: {
        codeHash: digest(email, code),
        expiresAt,
        attempts: 0,
        verifiedAt: null,
        createdAt: now,
      },
      setWhere: lt(
        emailVerifications.createdAt,
        new Date(now.getTime() - RESEND_COOLDOWN_MS),
      ),
    })
    .returning({ expiresAt: emailVerifications.expiresAt });

  if (row) return { ok: true, code, expiresAt: row.expiresAt };

  // The upsert declined, so a row exists and is younger than the cooldown.
  // Read it back to say how much younger.
  const [existing] = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(eq(emailVerifications.email, email))
    .limit(1);

  const elapsed = existing ? Date.now() - existing.createdAt.getTime() : 0;
  return {
    ok: false,
    reason: "throttled",
    retryAfterMs: Math.max(1, RESEND_COOLDOWN_MS - elapsed),
  };
}

export type VerifyCodeFailure =
  | "no-code"
  | "expired"
  | "too-many-attempts"
  | "mismatch";

/**
 * `matched` says whether *this call* compared a code and found it right, as
 * opposed to finding the address already proven by an earlier one.
 *
 * Both are `ok`, because both mean the address is proven and the caller can
 * carry on. Only the first is evidence about whoever is asking, though, so
 * only the first may be turned into a registration proof — see the note on
 * the shortcut in `explainRefusal`, and `app/register/actions.ts` for the
 * cookie that hangs off it.
 */
export type VerifyCodeResult =
  | { ok: true; matched: boolean }
  | { ok: false; reason: VerifyCodeFailure; attemptsLeft: number };

/**
 * Spends one attempt against the outstanding code for an address.
 *
 * The attempt is claimed by the same statement that reads the digest, because
 * a cap enforced by read-then-write is not a cap: several guesses arriving at
 * once would all see the same count and all be let through. Here they contend
 * for the row and the loser is counted.
 *
 * Verifying twice succeeds. The second click of a button is not an error, and
 * the row still says what the caller wants to know.
 */
export async function verifyCode(
  email: string,
  code: string,
): Promise<VerifyCodeResult> {
  const [claimed] = await db
    .update(emailVerifications)
    .set({ attempts: sql`${emailVerifications.attempts} + 1` })
    .where(
      and(
        eq(emailVerifications.email, email),
        sql`${emailVerifications.verifiedAt} is null`,
        sql`${emailVerifications.expiresAt} > now()`,
        lt(emailVerifications.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning({
      codeHash: emailVerifications.codeHash,
      attempts: emailVerifications.attempts,
    });

  if (!claimed) return explainRefusal(email);

  if (!matches(claimed.codeHash, digest(email, code))) {
    return {
      ok: false,
      reason: "mismatch",
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - claimed.attempts),
    };
  }

  const verifiedAt = new Date();
  await db
    .update(emailVerifications)
    .set({
      verifiedAt,
      expiresAt: new Date(verifiedAt.getTime() + VERIFIED_TTL_MS),
    })
    .where(eq(emailVerifications.email, email));

  return { ok: true, matched: true };
}

/**
 * Why nothing was claimed. Only reached on the unhappy path, so the extra read
 * costs nothing that matters and buys an error a person can act on: "ask for a
 * new code" and "you have run out of tries" call for different next steps.
 */
async function explainRefusal(email: string): Promise<VerifyCodeResult> {
  const [row] = await db
    .select({
      expiresAt: emailVerifications.expiresAt,
      attempts: emailVerifications.attempts,
      verifiedAt: emailVerifications.verifiedAt,
    })
    .from(emailVerifications)
    .where(eq(emailVerifications.email, email))
    .limit(1);

  if (!row) return { ok: false, reason: "no-code", attemptsLeft: 0 };

  const live = row.expiresAt.getTime() > Date.now();

  // Already proven, and the proof has not lapsed. The row says what the caller
  // wanted to establish, so the second press of the button is not an error.
  //
  // `matched: false` because nothing was compared: the update above declined
  // the row on `verified_at is null`, so the code was never read and no
  // attempt was spent. Whoever is asking could have typed anything, which is
  // why this answer must not be worth a registration proof.
  if (row.verifiedAt && live) return { ok: true, matched: false };

  if (!live) return { ok: false, reason: "expired", attemptsLeft: 0 };
  return { ok: false, reason: "too-many-attempts", attemptsLeft: 0 };
}

/** Whether an address has been proven recently enough to register with. */
export async function isEmailVerified(email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: emailVerifications.email })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, email),
        isNotNull(emailVerifications.verifiedAt),
        sql`${emailVerifications.expiresAt} > now()`,
      ),
    )
    .limit(1);

  return Boolean(row);
}

/**
 * Drops the proof once it has been spent on an account.
 *
 * Deleted rather than kept: `accounts.email_verified_at` is the durable record
 * that the address was proven, and a second copy of a mailbox nobody needs any
 * more is one more place an address has to be deleted from.
 *
 * Takes an optional `DbOrTx` so registration can spend the proof in the same
 * transaction that writes the account. Spending it outside would mean a
 * rollback leaves an address that is no longer provable and no account to show
 * for it — a mail round trip charged for nothing.
 */
export async function consumeVerifiedEmail(
  email: string,
  on: DbOrTx = db,
): Promise<void> {
  await on
    .delete(emailVerifications)
    .where(eq(emailVerifications.email, email));
}

/**
 * Forgets addresses that never finished.
 *
 * Every row here is someone's mailbox, and an abandoned signup should not
 * leave one lying in the database indefinitely. Re-issuing overwrites by
 * primary key, so this is not about size — it is that the table has no reason
 * to hold an address once the deadline that made it useful has passed.
 */
export async function purgeExpiredVerifications(): Promise<number> {
  const deleted = await db
    .delete(emailVerifications)
    .where(lt(emailVerifications.expiresAt, new Date()))
    .returning({ email: emailVerifications.email });

  return deleted.length;
}

/**
 * Exposed so callers can state these numbers rather than guess at them.
 *
 * `resendCooldownMs` is milliseconds and not seconds on purpose: it is the
 * same value the upsert above compares against, and converting it here would
 * put a second unit in the codebase for a "resend" button to pick the wrong
 * one of. It governs the code this module mints and nothing else — the reset
 * mail is paced separately, see the note on the constant.
 */
export const codeTtlMinutes = CODE_TTL_MS / 60_000;
export const maxAttempts = MAX_ATTEMPTS;
export const resendCooldownMs = RESEND_COOLDOWN_MS;

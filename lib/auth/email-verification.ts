import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailVerifications } from "@/lib/db/schema";

/**
 * The short code that proves someone can read the address they typed.
 *
 * This is the sibling of `lib/auth/tokens.ts` and deliberately not part of it.
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
 * The address is inside the digest, so a code mailed to one mailbox cannot be
 * replayed against another. Without it a person who can receive mail anywhere
 * could request a code for their own address and offer it for someone else's.
 */
function digest(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
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

export type VerifyCodeResult =
  | { ok: true }
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

  return { ok: true };
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
  if (row.verifiedAt && live) return { ok: true };

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
 */
export async function consumeVerifiedEmail(email: string): Promise<void> {
  await db
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

/** Exposed so the form can say how long a code lasts without guessing. */
export const codeTtlMinutes = CODE_TTL_MS / 60_000;
export const maxAttempts = MAX_ATTEMPTS;
export const resendCooldownMs = RESEND_COOLDOWN_MS;

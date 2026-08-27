import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/accounts/queries";
import { db } from "@/lib/db";
import { emailVerifications } from "@/lib/db/schema";

const CODE_TTL_MS = 10 * 60 * 1000;

const VERIFIED_TTL_MS = 30 * 60 * 1000;

const RESEND_COOLDOWN_MS = 60_000;

const MAX_ATTEMPTS = 5;

const CODE_DIGITS = 6;

function pepper(): string {
  return process.env.AUTH_SECRET!;
}

function digest(email: string, code: string): string {
  return createHmac("sha256", pepper()).update(`${email}:${code}`).digest("hex");
}

function matches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function mintCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

export type IssueCodeResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "throttled"; retryAfterMs: number };

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
  | { ok: true; matched: boolean }
  | { ok: false; reason: VerifyCodeFailure; attemptsLeft: number };

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

  if (row.verifiedAt && live) return { ok: true, matched: false };

  if (!live) return { ok: false, reason: "expired", attemptsLeft: 0 };
  return { ok: false, reason: "too-many-attempts", attemptsLeft: 0 };
}

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

export async function consumeVerifiedEmail(
  email: string,
  on: DbOrTx = db,
): Promise<void> {
  await on
    .delete(emailVerifications)
    .where(eq(emailVerifications.email, email));
}

export async function purgeExpiredVerifications(): Promise<number> {
  const deleted = await db
    .delete(emailVerifications)
    .where(lt(emailVerifications.expiresAt, new Date()))
    .returning({ email: emailVerifications.email });

  return deleted.length;
}

export const codeTtlMinutes = CODE_TTL_MS / 60_000;
export const maxAttempts = MAX_ATTEMPTS;
export const resendCooldownMs = RESEND_COOLDOWN_MS;

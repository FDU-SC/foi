import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { normalizeHandle } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { authTokens } from "@/lib/db/schema";
import type { TokenPurpose } from "@/lib/db/schema";

/**
 * Single-use secrets that arrive by email.
 *
 * Both purposes are the same three steps — mint, mail, redeem — so they are
 * one module rather than two. What differs is only what redemption is allowed
 * to do, which is the caller's business.
 *
 * Tokens are 160 bits of randomness, so a fast digest is enough: there is no
 * low-entropy secret here for an attacker to grind against, and a unique index
 * on the digest means redemption is a primary-key lookup rather than a scan
 * plus a constant-time compare.
 */

const DEFAULT_TTL_MS = {
  email_verify: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
} as const satisfies Record<TokenPurpose, number>;

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Mints a token, retiring any other unconsumed one for the same purpose.
 *
 * Only one outstanding code per purpose keeps the mental model simple — asking
 * for a new password-reset link should invalidate the last one, or a leaked
 * old email stays live for its full hour after the person has noticed.
 */
export async function issueToken(
  handle: string,
  purpose: TokenPurpose,
  options?: { ttlMs?: number },
): Promise<IssuedToken> {
  const normalized = normalizeHandle(handle);
  const token = randomBytes(20).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (options?.ttlMs ?? DEFAULT_TTL_MS[purpose]),
  );

  await revokeTokens(normalized, purpose);

  await db.insert(authTokens).values({
    id: `tok_${ulid()}`,
    handle: normalized,
    purpose,
    tokenHash: digest(token),
    expiresAt,
  });

  return { token, expiresAt };
}

export type RedeemResult =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Consumes a token, atomically.
 *
 * The single statement is what makes it single-use: two requests arriving with
 * the same link race on the same row and exactly one of them sees a result.
 * Doing it as select-then-update would let both through.
 */
export async function redeemToken(
  token: string,
  purpose: TokenPurpose,
  options?: { expectHandle?: string },
): Promise<RedeemResult> {
  const hash = digest(token);

  const [row] = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        sql`${authTokens.expiresAt} > now()`,
      ),
    )
    .returning({ handle: authTokens.handle });

  if (row) {
    // Callers that already know who the token should belong to can say so.
    // Links carry the token alone and pass no expectation.
    if (
      options?.expectHandle &&
      normalizeHandle(options.expectHandle) !== row.handle
    ) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, handle: row.handle };
  }

  // Nothing was consumed. Separate "you waited too long" from "this was never
  // a link", because only the first is worth telling someone how to fix.
  const [existing] = await db
    .select({ expiresAt: authTokens.expiresAt })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    )
    .limit(1);

  return {
    ok: false,
    reason: existing && existing.expiresAt.getTime() <= Date.now()
      ? "expired"
      : "invalid",
  };
}

/**
 * Looks a token up without spending it.
 *
 * This exists for one case: somebody refreshing the page a verification link
 * landed on. The token is gone by then, and reporting "invalid link" to a
 * person whose account was just verified would be both wrong and alarming.
 * The caller checks the account instead and reports what is actually true.
 */
export async function inspectToken(
  token: string,
  purpose: TokenPurpose,
): Promise<{ handle: string; consumedAt: Date | null } | null> {
  const [row] = await db
    .select({ handle: authTokens.handle, consumedAt: authTokens.consumedAt })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, digest(token)),
        eq(authTokens.purpose, purpose),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function revokeTokens(
  handle: string,
  purpose: TokenPurpose,
): Promise<void> {
  await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.handle, normalizeHandle(handle)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    );
}

/**
 * When the last token of this purpose was minted, consumed or not.
 *
 * This is the resend throttle, and it is deliberately not a separate
 * rate-limit store: the row that proves an email was sent is the same row that
 * says how long ago. It survives a restart and two processes see the same
 * answer, neither of which is true of an in-memory counter.
 */
export async function lastIssuedAt(
  handle: string,
  purpose: TokenPurpose,
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: authTokens.createdAt })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.handle, normalizeHandle(handle)),
        eq(authTokens.purpose, purpose),
      ),
    )
    .orderBy(desc(authTokens.createdAt))
    .limit(1);

  return row?.createdAt ?? null;
}

export interface PendingToken {
  handle: string;
  purpose: TokenPurpose;
  expiresAt: Date;
}

/** Outstanding, unexpired tokens — what `/admin` shows as "code issued". */
export async function listPendingTokens(
  purpose?: TokenPurpose,
): Promise<PendingToken[]> {
  return db
    .select({
      handle: authTokens.handle,
      purpose: authTokens.purpose,
      expiresAt: authTokens.expiresAt,
    })
    .from(authTokens)
    .where(
      and(
        isNull(authTokens.consumedAt),
        sql`${authTokens.expiresAt} > now()`,
        purpose ? eq(authTokens.purpose, purpose) : undefined,
      ),
    );
}

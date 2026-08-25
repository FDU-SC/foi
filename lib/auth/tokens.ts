import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { DbOrTx } from "@/lib/accounts/queries";
import { normalizeHandle } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { authTokens } from "@/lib/db/schema";
import type { TokenPurpose } from "@/lib/db/schema";

/**
 * Single-use secrets that arrive by email, addressed to an existing account.
 *
 * That last part is the dividing line between this module and
 * `./email-verification.ts`. A token here is minted against a handle and sent
 * as a link; the code there is minted against an address that may never become
 * an account, and is typed back into the page that asked for it. Sharing an
 * implementation would mean sharing `handle`, which is exactly what a signup
 * cannot supply.
 *
 * Tokens are 160 bits of randomness, so a fast digest is enough: there is no
 * low-entropy secret here for an attacker to grind against, and a unique index
 * on the digest means redemption is a primary-key lookup rather than a scan
 * plus a constant-time compare.
 *
 * Nothing here reads a token without spending it. There was an `inspectToken`
 * for one case that no longer exists — refreshing the page an address
 * verification link had landed on, where "invalid link" would have been both
 * wrong and alarming to somebody whose address had just been proven. Addresses
 * are proven by a typed code now, and `password_reset` is the only purpose
 * left: its page is handed the token in a query string and never asks the
 * database anything until the POST that consumes it. So a lookup that turns a
 * digest into a handle has no caller, and is not a question worth leaving
 * answerable.
 */

const DEFAULT_TTL_MS = {
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
 *
 * The retirement and the mint are one transaction, because apart they have a
 * state between them that nothing can get out of: every link revoked and no
 * new one written. A failed insert — a dropped connection, a constraint, the
 * process going away — left the account with nothing outstanding while
 * `sendPasswordReset` reported failure, so the person clicks the link already
 * in their inbox and is told it is invalid. Rolled back, that link is still
 * theirs.
 *
 * What the transaction does *not* buy is a guarantee that only one link is
 * ever live, and it is worth being clear about that rather than leaving the
 * paragraph above to be read as one. Two requests arriving together at read
 * committed both revoke what they can see, neither sees the other's uncommitted
 * insert, and both links come out valid. Closing that needs a lock on
 * something per-handle, and it is not worth one: the two links were minted
 * seconds apart and both went to the same proven mailbox, so nothing stale is
 * being kept alive — which is the only thing "only one outstanding" was ever
 * protecting against.
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

  await db.transaction(async (tx) => {
    await revokeTokens(normalized, purpose, tx);

    await tx.insert(authTokens).values({
      id: `tok_${ulid()}`,
      handle: normalized,
      purpose,
      tokenHash: digest(token),
      expiresAt,
    });
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
 *
 * Takes an optional `DbOrTx` so a caller can spend the token in the same
 * transaction as whatever the token was for. That does not weaken the line
 * above: a second request contends on the row lock and waits for the first to
 * commit, and if the first rolls back it was never spent at all — which is the
 * point, since a link burnt on a write that failed cannot be got back.
 *
 * There was an `expectHandle` option, for a caller that already knew whose
 * token it should be. Nothing ever passed one, and the implementation could
 * not have served such a caller anyway: the single statement below is what
 * makes this atomic, so the row is already consumed by the time there is a
 * handle to compare against. A mismatch would have answered "invalid" having
 * spent the link — burning somebody's only way back into their account in
 * order to tell its holder they were the wrong person. A check that can only
 * be made after the irreversible step is not a check.
 */
export async function redeemToken(
  token: string,
  purpose: TokenPurpose,
  on: DbOrTx = db,
): Promise<RedeemResult> {
  const hash = digest(token);

  const [row] = await on
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

  if (row) return { ok: true, handle: row.handle };

  // Nothing was consumed. Separate "you waited too long" from "this was never
  // a link", because only the first is worth telling someone how to fix.
  const [existing] = await on
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
 * Retires every outstanding token of a purpose.
 *
 * Takes a `DbOrTx` for `issueToken`, which has to do this and the insert as
 * one act — see the argument there. On its own it is still a caller-facing
 * operation: revoking without reissuing is what happens when a link should
 * simply stop working.
 */
export async function revokeTokens(
  handle: string,
  purpose: TokenPurpose,
  on: DbOrTx = db,
): Promise<void> {
  await on
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

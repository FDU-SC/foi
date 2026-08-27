import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { authTokens } from "@/lib/db/schema";
import type { TokenPurpose } from "@/lib/db/schema";
import type { DbOrTx } from "./queries";
import { normalizeHandle } from "./types";

const DEFAULT_TTL_MS = {
  password_reset: 60 * 60 * 1000,
} as const satisfies Record<TokenPurpose, number>;

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;

  id: string;
}

export async function issueToken(
  handle: string,
  purpose: TokenPurpose,
  options?: { ttlMs?: number; revokePrior?: boolean },
): Promise<IssuedToken> {
  const normalized = normalizeHandle(handle);
  const token = randomBytes(20).toString("base64url");
  const id = `tok_${ulid()}`;
  const expiresAt = new Date(
    Date.now() + (options?.ttlMs ?? DEFAULT_TTL_MS[purpose]),
  );

  await db.transaction(async (tx) => {
    if (options?.revokePrior !== false) {
      await revokeTokens(normalized, purpose, { on: tx });
    }

    await tx.insert(authTokens).values({
      id,
      handle: normalized,
      purpose,
      tokenHash: digest(token),
      expiresAt,
    });
  });

  return { token, expiresAt, id };
}

export type RedeemResult =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "expired" };

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

export async function revokeTokens(
  handle: string,
  purpose: TokenPurpose,
  options?: { on?: DbOrTx; exceptId?: string },
): Promise<void> {
  await (options?.on ?? db)
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.handle, normalizeHandle(handle)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        options?.exceptId ? ne(authTokens.id, options.exceptId) : undefined,
      ),
    );
}

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

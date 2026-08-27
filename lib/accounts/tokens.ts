import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { passwordResetTokens } from "@/lib/db/schema";
import type { DbOrTx } from "./queries";
import { normalizeHandle } from "./types";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

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
  options?: { ttlMs?: number; revokePrior?: boolean },
): Promise<IssuedToken> {
  const normalized = normalizeHandle(handle);
  const token = randomBytes(20).toString("base64url");
  const id = `tok_${ulid()}`;
  const expiresAt = new Date(
    Date.now() + (options?.ttlMs ?? DEFAULT_TTL_MS),
  );

  await db.transaction(async (tx) => {
    if (options?.revokePrior !== false) {
      await revokeTokens(normalized, { on: tx });
    }

    await tx.insert(passwordResetTokens).values({
      id,
      handle: normalized,
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
  on: DbOrTx = db,
): Promise<RedeemResult> {
  const hash = digest(token);

  const [row] = await on
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hash),
        isNull(passwordResetTokens.consumedAt),
        sql`${passwordResetTokens.expiresAt} > now()`,
      ),
    )
    .returning({ handle: passwordResetTokens.handle });

  if (row) return { ok: true, handle: row.handle };

  const [existing] = await on
    .select({ expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hash),
        isNull(passwordResetTokens.consumedAt),
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
  options?: { on?: DbOrTx; exceptId?: string },
): Promise<void> {
  await (options?.on ?? db)
    .update(passwordResetTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.handle, normalizeHandle(handle)),
        isNull(passwordResetTokens.consumedAt),
        options?.exceptId
          ? ne(passwordResetTokens.id, options.exceptId)
          : undefined,
      ),
    );
}

export async function lastIssuedAt(
  handle: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: passwordResetTokens.createdAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.handle, normalizeHandle(handle)))
    .orderBy(desc(passwordResetTokens.createdAt))
    .limit(1);

  return row?.createdAt ?? null;
}

export interface PendingToken {
  handle: string;
  expiresAt: Date;
}

export async function listPendingTokens(): Promise<PendingToken[]> {
  return db
    .select({
      handle: passwordResetTokens.handle,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .where(
      and(
        isNull(passwordResetTokens.consumedAt),
        sql`${passwordResetTokens.expiresAt} > now()`,
      ),
    );
}

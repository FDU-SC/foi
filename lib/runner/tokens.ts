import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { masterSecret } from "@/lib/backend/env";
import { deriveTokenSecret } from "@/lib/backend/keys.cjs";
import { db } from "@/lib/db";
import { accounts, runnerTokens, type RunnerTokenRow } from "@/lib/db/schema";
import { SLUG_PATTERN } from "@/lib/utils";

/**
 * A runner token reads `foir_<backendId>_<keyId>_<secret>`. Backend ids never
 * contain `_`, so the four fields split back apart unambiguously, and a runner
 * configured with the token alone knows which queue it serves.
 */
const PREFIX = "foir";

const KEY_ID = /^[0-9a-f]{16}$/;
const SECRET = /^[0-9a-f]{64}$/;

const TOUCH_INTERVAL_MS = 60_000;

export interface RunnerTokenParts {
  backendId: string;
  keyId: string;
  secret: string;
}

export function formatRunnerToken({ backendId, keyId, secret }: RunnerTokenParts): string {
  return [PREFIX, backendId, keyId, secret].join("_");
}

export function parseRunnerToken(token: string): RunnerTokenParts | null {
  const [prefix, backendId, keyId, secret, ...rest] = token.trim().split("_");
  if (prefix !== PREFIX || rest.length > 0) return null;
  if (!backendId || !SLUG_PATTERN.test(backendId)) return null;
  if (!keyId || !KEY_ID.test(keyId)) return null;
  if (!secret || !SECRET.test(secret)) return null;
  return { backendId, keyId, secret };
}

export function isKeyId(value: string): boolean {
  return KEY_ID.test(value);
}

/** The key a token signs with; undefined when no master key is configured. */
export function tokenSecret(backendId: string, keyId: string): string | undefined {
  const master = masterSecret();
  return master ? deriveTokenSecret(master, backendId, keyId) : undefined;
}

export async function issueRunnerToken(input: {
  backendId: string;
  label: string;
  createdBy: number;
}): Promise<{ token: string; row: RunnerTokenRow }> {
  const keyId = randomBytes(8).toString("hex");
  const secret = tokenSecret(input.backendId, keyId);
  if (!secret) throw new Error("缺少环境变量 FOI_BACKEND_SECRET");

  const [row] = await db
    .insert(runnerTokens)
    .values({ keyId, ...input })
    .returning();

  return { token: formatRunnerToken({ backendId: input.backendId, keyId, secret }), row };
}

export async function findRunnerToken(keyId: string): Promise<RunnerTokenRow | null> {
  const [row] = await db
    .select()
    .from(runnerTokens)
    .where(eq(runnerTokens.keyId, keyId))
    .limit(1);
  return row ?? null;
}

/** Null when the token does not exist or was already revoked. */
export async function revokeRunnerToken(
  keyId: string,
  revokedBy: number,
): Promise<RunnerTokenRow | null> {
  const [row] = await db
    .update(runnerTokens)
    .set({ revokedAt: new Date(), revokedBy })
    .where(and(eq(runnerTokens.keyId, keyId), isNull(runnerTokens.revokedAt)))
    .returning();
  return row ?? null;
}

/**
 * Whether a token whose signature has already verified is still live for this
 * backend. A verified signature with no live row means the token was revoked,
 * or was issued by another deployment that shares the master key.
 */
export async function acceptRunnerToken(
  backendId: string,
  keyId: string,
): Promise<boolean> {
  const row = await findRunnerToken(keyId);
  if (!row || row.backendId !== backendId || row.revokedAt) return false;

  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
    await db
      .update(runnerTokens)
      .set({ lastUsedAt: now })
      .where(eq(runnerTokens.keyId, keyId));
  }
  return true;
}

export interface RunnerTokenListing extends RunnerTokenRow {
  createdByName: string | null;
  revokedByName: string | null;
}

/** Live tokens first, newest first within each group. */
export async function listRunnerTokens(
  backendIds: readonly string[],
): Promise<RunnerTokenListing[]> {
  if (backendIds.length === 0) return [];

  const rows = await db
    .select()
    .from(runnerTokens)
    .where(inArray(runnerTokens.backendId, [...backendIds]))
    .orderBy(desc(runnerTokens.createdAt));

  const uids = [
    ...new Set(
      rows.flatMap((row) => (row.revokedBy === null ? [row.createdBy] : [row.createdBy, row.revokedBy])),
    ),
  ];
  const names = new Map(
    uids.length === 0
      ? []
      : (
          await db
            .select({ uid: accounts.uid, username: accounts.username })
            .from(accounts)
            .where(inArray(accounts.uid, uids))
        ).map((account) => [account.uid, account.username]),
  );

  return rows
    .map((row) => ({
      ...row,
      createdByName: names.get(row.createdBy) ?? null,
      revokedByName: row.revokedBy === null ? null : (names.get(row.revokedBy) ?? null),
    }))
    .sort((left, right) => Number(left.revokedAt !== null) - Number(right.revokedAt !== null));
}

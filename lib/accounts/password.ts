import { hash, verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { fingerprint as computeFingerprint } from "@/lib/tokens/stateless";
import ARGON2_OPTIONS from "./argon2-options.cjs";
import type { DbOrTx } from "./queries";

const decoyHash = hash("decoy-for-constant-time-login", ARGON2_OPTIONS);

function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export type PasswordCheck = { ok: true; setAt: Date } | { ok: false };

export async function verifyPassword(
  uid: number,
  password: string,
): Promise<PasswordCheck> {
  const [row] = await db
    .select({
      passwordHash: accounts.passwordHash,
      passwordSetAt: accounts.passwordSetAt,
    })
    .from(accounts)
    .where(eq(accounts.uid, uid))
    .limit(1);

  if (!row?.passwordHash || !row.passwordSetAt) {
    await verify(await decoyHash, password).catch(() => false);
    return { ok: false };
  }

  const matched = await verify(row.passwordHash, password).catch(() => false);
  return matched ? { ok: true, setAt: row.passwordSetAt } : { ok: false };
}

export async function passwordSetAt(uid: number): Promise<Date | null> {
  const [row] = await db
    .select({ passwordSetAt: accounts.passwordSetAt })
    .from(accounts)
    .where(eq(accounts.uid, uid))
    .limit(1);

  return row?.passwordSetAt ?? null;
}

export function sessionMatchesPassword(
  setAt: Date | null,
  passwordAt: number,
): boolean {
  if (!setAt) return false;
  return setAt.getTime() <= passwordAt;
}

export async function setPassword(
  uid: number,
  password: string,
  on: DbOrTx = db,
): Promise<void> {
  const passwordHash = await hashPassword(password);

  const [row] = await on
    .update(accounts)
    .set({ passwordHash, passwordSetAt: sql`now()` })
    .where(eq(accounts.uid, uid))
    .returning({ uid: accounts.uid });

  if (!row) throw new Error(`账号 uid=${uid} 不存在，无法设置密码`);
}

export async function getPasswordFingerprint(
  uid: number,
): Promise<string | null> {
  const [row] = await db
    .select({ passwordHash: accounts.passwordHash })
    .from(accounts)
    .where(eq(accounts.uid, uid))
    .limit(1);

  if (!row?.passwordHash) return null;
  return computeFingerprint(row.passwordHash);
}

export async function getEmailFingerprint(
  uid: number,
): Promise<string | null> {
  const [row] = await db
    .select({ email: accounts.email })
    .from(accounts)
    .where(eq(accounts.uid, uid))
    .limit(1);

  if (!row?.email) return null;
  return computeFingerprint(row.email);
}

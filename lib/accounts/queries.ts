import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import {
  accountAvatars,
  accountColumns,
  accounts,
  accountSuspensions,
} from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type {
  AccountAvatarRow,
  AccountRow,
  AccountStatus,
  AccountSuspensionRow,
} from "@/lib/db/schema";
import { invalidateAccounts } from "./cache";
import { normalizeUsername } from "./types";

export type DbOrTx = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export async function getAccount(
  uid: number,
  on: DbOrTx = db,
): Promise<AccountRow | undefined> {
  const [row] = await on
    .select(accountColumns)
    .from(accounts)
    .where(eq(accounts.uid, uid))
    .limit(1);
  return row;
}

export async function getAccountByUsername(
  username: string,
  on: DbOrTx = db,
): Promise<AccountRow | undefined> {
  const [row] = await on
    .select(accountColumns)
    .from(accounts)
    .where(sql`lower(${accounts.username}) = ${normalizeUsername(username)}`)
    .limit(1);
  return row;
}

export async function findAccountByEmail(
  email: string,
  on: DbOrTx = db,
): Promise<AccountRow | undefined> {
  const [row] = await on
    .select(accountColumns)
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  return row;
}

export async function listAccounts(options?: {
  status?: AccountStatus;

  /** What the viewer is allowed to see, from `rowScope`. */
  scope?: SQL;
}): Promise<AccountRow[]> {
  const filters = [
    options?.scope,
    options?.status ? eq(accounts.status, options.status) : undefined,
  ].filter((clause) => clause !== undefined);

  return db
    .select(accountColumns)
    .from(accounts)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(accounts.uid));
}

export interface CreateAccountInput {
  username: string;
  nickname: string;
  email?: string | null;
  status?: AccountStatus;
}

export async function createAccount(
  input: CreateAccountInput,
  on: DbOrTx = db,
): Promise<AccountRow | undefined> {
  const [row] = await on
    .insert(accounts)
    .values({
      username: input.username,
      nickname: input.nickname,
      email: input.email ?? null,
      status: input.status ?? "active",
    })
    .onConflictDoNothing()
    .returning(accountColumns);

  if (row) invalidateAccounts();
  return row;
}

export async function updateNickname(
  uid: number,
  nickname: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .update(accounts)
    .set({ nickname, updatedAt: sql`now()` })
    .where(eq(accounts.uid, uid))
    .returning(accountColumns);

  if (row) invalidateAccounts();
  return row;
}

export async function getAvatar(
  uid: number,
): Promise<AccountAvatarRow | undefined> {
  const [row] = await db
    .select()
    .from(accountAvatars)
    .where(eq(accountAvatars.uid, uid))
    .limit(1);
  return row;
}

/**
 * The bytes and the marker on the account move together: a viewer told an
 * avatar exists at a given moment must find those exact bytes behind the URL
 * that moment names.
 *
 * Both columns take `now()` rather than a timestamp carried between them,
 * because within one transaction `now()` is a single instant, while a value
 * routed through a JS `Date` loses everything below the millisecond.
 */
export async function setAvatar(
  uid: number,
  image: Uint8Array,
): Promise<Date | undefined> {
  const bytes = Buffer.from(image);

  const updatedAt = await db.transaction(async (tx) => {
    const [account] = await tx
      .update(accounts)
      .set({ avatarUpdatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(accounts.uid, uid))
      .returning({ avatarUpdatedAt: accounts.avatarUpdatedAt });

    if (!account?.avatarUpdatedAt) return undefined;

    await tx
      .insert(accountAvatars)
      .values({ uid, image: bytes, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: accountAvatars.uid,
        set: { image: bytes, updatedAt: sql`now()` },
      });

    return account.avatarUpdatedAt;
  });

  if (updatedAt) invalidateAccounts();
  return updatedAt;
}

export async function clearAvatar(uid: number): Promise<boolean> {
  const cleared = await db.transaction(async (tx) => {
    const [account] = await tx
      .update(accounts)
      .set({ avatarUpdatedAt: null, updatedAt: sql`now()` })
      .where(eq(accounts.uid, uid))
      .returning({ uid: accounts.uid });

    if (!account) return false;

    await tx.delete(accountAvatars).where(eq(accountAvatars.uid, uid));
    return true;
  });

  if (cleared) invalidateAccounts();
  return cleared;
}

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export type UsernameUpdate =
  | { ok: true; account: AccountRow }
  | { ok: false; reason: "taken" | "missing" };

export async function updateUsername(
  uid: number,
  username: string,
): Promise<UsernameUpdate> {
  let row: AccountRow | undefined;

  try {
    [row] = await db
      .update(accounts)
      .set({
        username,
        usernameChangedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(accounts.uid, uid))
      .returning(accountColumns);
  } catch (error) {
    // The pre-check and this write are not atomic; the unique index is the real referee.
    if (isUniqueViolation(error)) return { ok: false, reason: "taken" };
    throw error;
  }

  if (!row) return { ok: false, reason: "missing" };

  invalidateAccounts();
  return { ok: true, account: row };
}

export async function suspendAccount(
  uid: number,
  by: number,
  reason: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .update(accounts)
    .set({ status: "suspended", updatedAt: sql`now()` })
    .where(eq(accounts.uid, uid))
    .returning(accountColumns);

  if (!row) return undefined;

  await db.insert(accountSuspensions).values({
    id: `sus_${ulid()}`,
    uid,
    action: "suspend",
    performedBy: by,
    reason,
  });

  invalidateAccounts();
  return row;
}

export async function reinstateAccount(
  uid: number,
  by: number,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .update(accounts)
    .set({ status: "active", updatedAt: sql`now()` })
    .where(eq(accounts.uid, uid))
    .returning(accountColumns);

  if (!row) return undefined;

  await db.insert(accountSuspensions).values({
    id: `sus_${ulid()}`,
    uid,
    action: "reinstate",
    performedBy: by,
  });

  invalidateAccounts();
  return row;
}

export async function suspensionHistory(
  uid: number,
  limit = 10,
): Promise<AccountSuspensionRow[]> {
  return db
    .select()
    .from(accountSuspensions)
    .where(eq(accountSuspensions.uid, uid))
    .orderBy(desc(accountSuspensions.createdAt))
    .limit(limit);
}

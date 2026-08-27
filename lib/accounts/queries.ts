import { asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import {
  accountColumns,
  accounts,
  accountSuspensions,
} from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type {
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
}): Promise<AccountRow[]> {
  return db
    .select(accountColumns)
    .from(accounts)
    .where(options?.status ? eq(accounts.status, options.status) : undefined)
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

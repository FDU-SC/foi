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
import { normalizeHandle } from "./types";

export type DbOrTx = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export async function getAccount(
  handle: string,
  on: DbOrTx = db,
): Promise<AccountRow | undefined> {
  const [row] = await on
    .select(accountColumns)
    .from(accounts)
    .where(eq(accounts.handle, normalizeHandle(handle)))
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
    .orderBy(asc(accounts.handle));
}

export interface CreateAccountInput {
  handle: string;
  displayName: string;
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
      handle: normalizeHandle(input.handle),
      displayName: input.displayName,
      email: input.email ?? null,
      status: input.status ?? "active",
    })
    .onConflictDoNothing()
    .returning(accountColumns);

  if (row) invalidateAccounts();
  return row;
}

export async function suspendAccount(
  handle: string,
  by: string,
  reason: string,
): Promise<AccountRow | undefined> {
  const normalized = normalizeHandle(handle);

  const [row] = await db
    .update(accounts)
    .set({ status: "suspended", updatedAt: sql`now()` })
    .where(eq(accounts.handle, normalized))
    .returning(accountColumns);

  if (!row) return undefined;

  await db.insert(accountSuspensions).values({
    id: `sus_${ulid()}`,
    handle: normalized,
    action: "suspend",
    performedBy: by,
    reason,
  });

  invalidateAccounts();
  return row;
}

export async function reinstateAccount(
  handle: string,
  by: string,
): Promise<AccountRow | undefined> {
  const normalized = normalizeHandle(handle);

  const [row] = await db
    .update(accounts)
    .set({ status: "active", updatedAt: sql`now()` })
    .where(eq(accounts.handle, normalized))
    .returning(accountColumns);

  if (!row) return undefined;

  await db.insert(accountSuspensions).values({
    id: `sus_${ulid()}`,
    handle: normalized,
    action: "reinstate",
    performedBy: by,
  });

  invalidateAccounts();
  return row;
}

export async function suspensionHistory(
  handle: string,
  limit = 10,
): Promise<AccountSuspensionRow[]> {
  return db
    .select()
    .from(accountSuspensions)
    .where(eq(accountSuspensions.handle, normalizeHandle(handle)))
    .orderBy(desc(accountSuspensions.createdAt))
    .limit(limit);
}

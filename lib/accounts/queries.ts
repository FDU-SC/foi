import { asc, eq, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { accountColumns, accounts } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type { AccountRow, AccountSource, AccountStatus } from "@/lib/db/schema";
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
  source?: AccountSource;
  status?: AccountStatus;
  emailVerifiedAt?: Date | null;
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
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      source: input.source ?? "registration",
      status: input.status ?? "active",
    })
    .onConflictDoNothing()
    .returning(accountColumns);

  if (row) invalidateAccounts();
  return row;
}

async function updateAccount(
  handle: string,
  patch: Partial<
    Pick<
      AccountRow,
      | "status"
      | "suspendedAt"
      | "suspendedBy"
      | "suspendedReason"
      | "reinstatedAt"
    >
  >,
): Promise<AccountRow | undefined> {

  const [row] = await db
    .update(accounts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(accounts.handle, normalizeHandle(handle)))
    .returning(accountColumns);

  if (row) invalidateAccounts();
  return row;
}

export async function suspendAccount(
  handle: string,
  by: string,
  reason: string,
): Promise<AccountRow | undefined> {
  return updateAccount(handle, {
    status: "suspended",
    suspendedAt: new Date(),
    suspendedBy: by,
    suspendedReason: reason,
    reinstatedAt: null,
  });
}

export async function reinstateAccount(
  handle: string,
): Promise<AccountRow | undefined> {
  return updateAccount(handle, { status: "active", reinstatedAt: new Date() });
}

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import type { AccountRow, AccountSource, AccountStatus } from "@/lib/db/schema";
import { invalidateAccounts } from "./cache";
import { normalizeHandle } from "./types";

/**
 * Every write to `accounts` goes through here, because every write has to
 * invalidate the snapshot in `./cache.ts`. Reads that decide whether somebody
 * may act go through `getAccount`, which never consults that snapshot.
 */

/**
 * The authoritative read: one row, by primary key, no cache in front of it.
 *
 * Authorisation calls this. A suspension has to bite on the very next request,
 * which rules out reading `status` from anything with a TTL.
 */
export async function getAccount(
  handle: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.handle, normalizeHandle(handle)))
    .limit(1);
  return row;
}

export async function findAccountByEmail(
  email: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  return row;
}

export async function listAccounts(options?: {
  status?: AccountStatus;
}): Promise<AccountRow[]> {
  return db
    .select()
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

/**
 * Returns undefined when the handle or the address is already taken, rather
 * than throwing: both are ordinary outcomes of two people racing on the
 * registration form, and the caller has a message for each.
 */
export async function createAccount(
  input: CreateAccountInput,
): Promise<AccountRow | undefined> {
  const [row] = await db
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
    .returning();

  if (row) invalidateAccounts();
  return row;
}

export async function updateAccount(
  handle: string,
  patch: Partial<
    Pick<
      AccountRow,
      | "displayName"
      | "email"
      | "emailVerifiedAt"
      | "status"
      | "suspendedAt"
      | "suspendedBy"
      | "suspendedReason"
    >
  >,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .update(accounts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(accounts.handle, normalizeHandle(handle)))
    .returning();

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
  });
}

/**
 * The audit columns are cleared on the way back in. Keeping them would read as
 * "currently suspended" to every query that checks `suspendedAt`, and the
 * history of the decision belongs in the review that produced it.
 */
export async function reinstateAccount(
  handle: string,
): Promise<AccountRow | undefined> {
  return updateAccount(handle, {
    status: "active",
    suspendedAt: null,
    suspendedBy: null,
    suspendedReason: null,
  });
}

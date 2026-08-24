import { asc, eq } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type { AccountRow, AccountSource, AccountStatus } from "@/lib/db/schema";
import { invalidateAccounts } from "./cache";
import { normalizeHandle } from "./types";

/**
 * Every write to `accounts` goes through here, because every write has to
 * invalidate the snapshot in `./cache.ts`. Reads that decide whether somebody
 * may act go through `getAccount`, which never consults that snapshot.
 *
 * The ones registration and password reset need take an optional `DbOrTx` so
 * they can be pulled into a transaction with the writes in `lib/auth/`. Read
 * that way the account is the one the same transaction is about to act on;
 * written that way the invalidation fires before the commit does, which at
 * worst leaves the snapshot a few seconds behind a row that is about to exist
 * — the staleness the TTL already allows, and never a decision about access,
 * which reads its own row.
 */

/**
 * A pool-backed handle or a transaction on one, spelled as the type both are.
 *
 * `typeof db` will not do: what `drizzle()` returns carries a `$client` that
 * the transaction object has no equivalent of. Naming their common supertype
 * is what lets one function serve both callers, instead of a second copy of
 * each statement existing for transactions to drift away from.
 */
export type DbOrTx = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/**
 * The authoritative read: one row, by primary key, no cache in front of it.
 *
 * Authorisation calls this. A suspension has to bite on the very next request,
 * which rules out reading `status` from anything with a TTL.
 */
export async function getAccount(
  handle: string,
  on: DbOrTx = db,
): Promise<AccountRow | undefined> {
  const [row] = await on
    .select()
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
    .returning();

  if (row) invalidateAccounts();
  return row;
}

/**
 * Moderation, and only moderation.
 *
 * The patch used to admit `displayName`, `email` and `emailVerifiedAt` as
 * well, none of which anything ever passed: a handle is fixed at registration,
 * an address is changed by proving the new one rather than by an update, and
 * nothing un-verifies one. A type that describes writes no caller makes is an
 * invitation to make them here, bypassing the proof each of those fields is
 * supposed to rest on.
 */
export async function updateAccount(
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
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(accounts.handle, normalizeHandle(handle)))
    .returning();

  if (row) invalidateAccounts();
  return row;
}

/**
 * Clears `reinstatedAt`, which is what keeps the four columns one episode.
 *
 * Leaving it would let a row carry a suspension newer than the reinstatement
 * that supposedly ended it — an ordering no reader could make sense of, and
 * the kind of state worth making unrepresentable rather than explaining.
 */
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

/**
 * `status` moves and `reinstatedAt` is stamped. The three suspension columns
 * keep what the last suspension put there, so all four describe the most
 * recent episode rather than the current state.
 *
 * They used to be cleared, on the reasoning that keeping them would read as
 * "currently suspended" to a query that checked `suspendedAt`. No such query
 * exists — `status` is the only thing anything asks, from `resolveFromRow`'s
 * `disabled` down to the badge on `/admin/accounts`. So the columns were not
 * load-bearing; they were the entire record of a moderation decision, and a
 * reinstatement erased it. Somebody suspended and let back in twice left no
 * trace of either.
 *
 * Four columns rather than an events table, and that is a ceiling worth
 * naming: this records the *last* episode, not a history. A second suspension
 * overwrites the first, and nothing here can answer how many there were. An
 * `account_moderation_events` table is the shape that answers that, and it is
 * a bigger claim than the console currently makes — the page shows one badge
 * and one reason, not a timeline. Widen it when something needs to read the
 * history, not in advance.
 */
export async function reinstateAccount(
  handle: string,
): Promise<AccountRow | undefined> {
  return updateAccount(handle, { status: "active", reinstatedAt: new Date() });
}

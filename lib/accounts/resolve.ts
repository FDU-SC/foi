import type { AccountRow } from "@/lib/db/schema";
import { groupsFor } from "@/lib/enrollment/registry";
import { getAccount } from "./queries";
import type { ResolvedUser } from "./types";

/**
 * Where the two sources of truth meet.
 *
 * The database answers "who is this" — the display name they chose, the
 * address they verified, whether they are suspended. The repository answers
 * "which groups is this" — the rules that sort an address, plus any grant
 * naming the handle. Neither can stand in for the other, and the merged shape
 * is never written back to a row: membership is a function of the address and
 * the rules, so storing it would mean re-deriving every account each time a
 * rule changed, instead of the change simply taking effect.
 *
 * Almost every account has no grant at all — people sign themselves up, and an
 * ordinary competitor needs no entry anywhere. That is exactly why a
 * privileged group can only be joined by naming somebody in a reviewed file.
 */
export function resolveFromRow(account: AccountRow): ResolvedUser {
  return {
    handle: account.handle,
    displayName: account.displayName,
    email: account.email,
    emailVerified: account.emailVerifiedAt !== null,
    groups: groupsFor(account.handle, account.email),
    status: account.status,
    disabled: account.status !== "active",
  };
}

/**
 * Reads the account by primary key, deliberately bypassing the snapshot in
 * `./cache.ts`: this is the function authorisation is built on, and a
 * suspension must bite on the next request rather than when a TTL expires.
 */
export async function resolveUser(
  handle: string,
): Promise<ResolvedUser | null> {
  const account = await getAccount(handle);
  return account ? resolveFromRow(account) : null;
}

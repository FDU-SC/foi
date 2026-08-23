import type { AccountRow } from "@/lib/db/schema";
import { getGrant, tagsFor } from "@/lib/enrollment/registry";
import { getAccount } from "./queries";
import type { ResolvedUser } from "./types";

/**
 * Where the two sources of truth meet.
 *
 * The database answers "who is this" — the display name they chose, the
 * address they verified, whether they are suspended. The repository answers
 * "what may they do" — the role, and the rules that turn an address into
 * cohort tags. Neither can stand in for the other, and the merged shape is
 * never written back to a row: tags are a function of the address and the
 * rules, so storing them would mean re-deriving every account each time a rule
 * changed, instead of the change simply taking effect.
 *
 * Almost every account has no grant at all — people sign themselves up, and an
 * ordinary competitor needs no entry anywhere. That is exactly why a role can
 * only be obtained by naming somebody in a reviewed file.
 */
export function resolveFromRow(account: AccountRow): ResolvedUser {
  const grant = getGrant(account.handle);

  return {
    handle: account.handle,
    displayName: account.displayName,
    email: account.email,
    emailVerified: account.emailVerifiedAt !== null,
    role: grant?.role ?? "user",
    tags: tagsFor(account.handle, account.email),
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

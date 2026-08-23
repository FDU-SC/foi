import type { AccountRow } from "@/lib/db/schema";
import { getMember } from "@/lib/roster/registry";
import { getAccount } from "./queries";
import type { ResolvedUser } from "./types";

/**
 * Where the two sources of truth meet.
 *
 * The database answers "who is this" — the display name they chose, the
 * address they verified, whether they are suspended. The repository answers
 * "what may they do" — the role, and the cohort tags that decide which
 * contests they are entered in. Neither can stand in for the other, and the
 * merged shape is never written back to a row: a role is a fact about a
 * decision, and decisions live in commits.
 *
 * Any account with no entry in the repository is an ordinary competitor. That
 * is the common case now that people sign themselves up, and it is why
 * privilege can only ever be granted by naming somebody in a reviewed file.
 */
export function resolveFromRow(account: AccountRow): ResolvedUser {
  const grant = getMember(account.handle);

  return {
    handle: account.handle,
    displayName: account.displayName,
    email: account.email,
    emailVerified: account.emailVerifiedAt !== null,
    role: grant?.role ?? "user",
    tags: grant?.tags ?? [],
    status: account.status,
    disabled: account.status !== "active" || (grant?.disabled ?? false),
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

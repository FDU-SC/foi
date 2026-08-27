import type { AccountRow } from "@/lib/db/schema";
import { groupsFor } from "@/lib/enrollment/registry";
import { getAccount } from "./queries";
import type { ResolvedUser } from "./types";

export function resolveFromRow(account: AccountRow): ResolvedUser {
  return {
    handle: account.handle,
    displayName: account.displayName,
    email: account.email,
    emailVerified: account.email !== null,
    groups: groupsFor(account.handle, account.email),
    status: account.status,
    disabled: account.status !== "active",
  };
}

export async function resolveUser(
  handle: string,
): Promise<ResolvedUser | null> {
  const account = await getAccount(handle);
  return account ? resolveFromRow(account) : null;
}

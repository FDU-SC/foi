import type { AccountRow } from "@/lib/db/schema";
import { groupsFor } from "@/lib/enrollment/registry";
import { getAccount, getAccountByUsername } from "./queries";
import type { ResolvedUser } from "./types";

export function resolveFromRow(account: AccountRow): ResolvedUser {
  return {
    uid: account.uid,
    username: account.username,
    nickname: account.nickname,
    email: account.email,
    emailVerified: account.email !== null,
    groups: groupsFor(account.uid, account.email),
    status: account.status,
    disabled: account.status !== "active",
  };
}

export async function resolveUser(
  uid: number,
): Promise<ResolvedUser | null> {
  const account = await getAccount(uid);
  return account ? resolveFromRow(account) : null;
}

export async function resolveUserByUsername(
  username: string,
): Promise<ResolvedUser | null> {
  const account = await getAccountByUsername(username);
  return account ? resolveFromRow(account) : null;
}

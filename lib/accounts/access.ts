import type { Viewer } from "@/lib/permissions/viewer";
import type { AccountRow, AccountStatus } from "@/lib/db/schema";
import { listAccounts } from "./queries";
import { listPendingTokens } from "./tokens";

export interface AccountDirectory {

  accounts: AccountRow[];

  awaitingReset: Set<string>;
}

const EMPTY: AccountDirectory = {
  accounts: [],
  awaitingReset: new Set(),
};

export async function accountDirectoryFor(
  viewer: Viewer,
): Promise<AccountDirectory> {
  if (!viewer.can("account.read")) return EMPTY;

  const [accounts, pending] = await Promise.all([
    listAccounts(),
    listPendingTokens("password_reset"),
  ]);

  return {
    accounts,
    awaitingReset: new Set(pending.map((row) => row.handle)),
  };
}

export async function accountsFor(
  viewer: Viewer,
  options?: { status?: AccountStatus },
): Promise<AccountRow[]> {
  if (!viewer.can("account.read")) return [];
  return listAccounts(options);
}

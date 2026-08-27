import type { Viewer } from "@/lib/permissions/viewer";
import type {
  AccountRow,
  AccountStatus,
  AccountSuspensionRow,
} from "@/lib/db/schema";
import { listAccounts, suspensionHistory } from "./queries";
import { listPendingTokens } from "./tokens";

export interface AccountDirectory {
  accounts: AccountRow[];
  awaitingReset: Set<string>;
  lastSuspensionEvents: Map<string, AccountSuspensionRow>;
}

const EMPTY: AccountDirectory = {
  accounts: [],
  awaitingReset: new Set(),
  lastSuspensionEvents: new Map(),
};

export async function accountDirectoryFor(
  viewer: Viewer,
): Promise<AccountDirectory> {
  if (!viewer.can("account.read")) return EMPTY;

  const [allAccounts, pending] = await Promise.all([
    listAccounts(),
    listPendingTokens(),
  ]);

  const suspendedHandles = allAccounts
    .filter((a) => a.status === "suspended")
    .map((a) => a.handle);

  const events = new Map<string, AccountSuspensionRow>();
  await Promise.all(
    suspendedHandles.map(async (handle) => {
      const [latest] = await suspensionHistory(handle, 1);
      if (latest) events.set(handle, latest);
    }),
  );

  return {
    accounts: allAccounts,
    awaitingReset: new Set(pending.map((row) => row.handle)),
    lastSuspensionEvents: events,
  };
}

export async function accountsFor(
  viewer: Viewer,
  options?: { status?: AccountStatus },
): Promise<AccountRow[]> {
  if (!viewer.can("account.read")) return [];
  return listAccounts(options);
}

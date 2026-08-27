import type { Viewer } from "@/lib/permissions/viewer";
import type {
  AccountRow,
  AccountStatus,
  AccountSuspensionRow,
} from "@/lib/db/schema";
import { listAccounts, suspensionHistory } from "./queries";

export interface AccountDirectory {
  accounts: AccountRow[];
  lastSuspensionEvents: Map<number, AccountSuspensionRow>;
}

const EMPTY: AccountDirectory = {
  accounts: [],
  lastSuspensionEvents: new Map(),
};

export async function accountDirectoryFor(
  viewer: Viewer,
): Promise<AccountDirectory> {
  if (!viewer.can("account.read")) return EMPTY;

  const allAccounts = await listAccounts();

  const suspendedUids = allAccounts
    .filter((a) => a.status === "suspended")
    .map((a) => a.uid);

  const events = new Map<number, AccountSuspensionRow>();
  await Promise.all(
    suspendedUids.map(async (uid) => {
      const [latest] = await suspensionHistory(uid, 1);
      if (latest) events.set(uid, latest);
    }),
  );

  return {
    accounts: allAccounts,
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

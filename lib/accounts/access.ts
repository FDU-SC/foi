import { rowScope } from "@/lib/authz/filter";
import type { Viewer } from "@/lib/authz/viewer";
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

export async function accountsFor(
  viewer: Viewer,
  options?: { status?: AccountStatus },
): Promise<AccountRow[]> {
  const scope = rowScope("account.read", viewer);
  if (scope.kind === "none") return [];

  return listAccounts({
    ...options,
    scope: scope.kind === "where" ? scope.sql : undefined,
  });
}

export async function accountDirectoryFor(
  viewer: Viewer,
): Promise<AccountDirectory> {
  const allAccounts = await accountsFor(viewer);
  if (allAccounts.length === 0) return EMPTY;

  const suspendedUids = allAccounts
    .filter((account) => account.status === "suspended")
    .map((account) => account.uid);

  const events = new Map<number, AccountSuspensionRow>();
  await Promise.all(
    suspendedUids.map(async (uid) => {
      const [latest] = await suspensionHistory(uid, 1);
      if (latest) events.set(uid, latest);
    }),
  );

  return { accounts: allAccounts, lastSuspensionEvents: events };
}

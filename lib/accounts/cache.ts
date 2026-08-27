import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import type { AccountStatus } from "@/lib/db/schema";

export interface AccountSummary {
  handle: string;
  displayName: string;
  email: string | null;
  status: AccountStatus;
}

interface Snapshot {
  byHandle: Map<string, AccountSummary>;
  expiresAt: number;
}

declare global {
  var __foiAccountSnapshot: Snapshot | undefined;
  var __foiAccountInflight: Promise<Snapshot> | undefined;
}

const TTL_MS = 10_000;

let snapshot = globalThis.__foiAccountSnapshot;
let inflight = globalThis.__foiAccountInflight;

async function load(): Promise<Snapshot> {
  const rows = await db
    .select({
      handle: accounts.handle,
      displayName: accounts.displayName,
      email: accounts.email,
      status: accounts.status,
    })
    .from(accounts);

  const next: Snapshot = {
    byHandle: new Map(rows.map((row) => [row.handle, row])),
    expiresAt: Date.now() + TTL_MS,
  };

  snapshot = next;
  if (process.env.NODE_ENV !== "production") {
    globalThis.__foiAccountSnapshot = next;
  }
  return next;
}

export async function accountSnapshot(): Promise<Map<string, AccountSummary>> {
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot.byHandle;

  if (!inflight) {
    inflight = load().finally(() => {
      inflight = undefined;
      if (process.env.NODE_ENV !== "production") {
        globalThis.__foiAccountInflight = undefined;
      }
    });
    if (process.env.NODE_ENV !== "production") {
      globalThis.__foiAccountInflight = inflight;
    }
  }

  return (await inflight).byHandle;
}

export function invalidateAccounts(): void {
  snapshot = undefined;
  globalThis.__foiAccountSnapshot = undefined;
}

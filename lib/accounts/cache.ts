import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import type { AccountStatus } from "@/lib/db/schema";

export interface AccountSummary {
  uid: number;
  username: string;
  nickname: string;
  email: string | null;
  status: AccountStatus;
}

interface Snapshot {
  byUid: Map<number, AccountSummary>;
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
      uid: accounts.uid,
      username: accounts.username,
      nickname: accounts.nickname,
      email: accounts.email,
      status: accounts.status,
    })
    .from(accounts);

  const next: Snapshot = {
    byUid: new Map(rows.map((row) => [row.uid, row])),
    expiresAt: Date.now() + TTL_MS,
  };

  snapshot = next;
  if (process.env.NODE_ENV !== "production") {
    globalThis.__foiAccountSnapshot = next;
  }
  return next;
}

export async function accountSnapshot(): Promise<Map<number, AccountSummary>> {
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot.byUid;

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

  return (await inflight).byUid;
}

export function invalidateAccounts(): void {
  snapshot = undefined;
  globalThis.__foiAccountSnapshot = undefined;
}

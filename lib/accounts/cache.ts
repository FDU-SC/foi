import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import type { AccountStatus } from "@/lib/db/schema";

/**
 * A process-local snapshot of who exists, so that rendering a page does not
 * turn one query into hundreds.
 *
 * The roster used to be a compile-time Map, which let submission lists and
 * standings resolve a display name with a synchronous lookup. Moving identity
 * into the database would otherwise have meant a join on every listing and a
 * batched fetch inside the standings computation. Holding the whole table for
 * a few seconds keeps those call sites in the shape they were already in, and
 * follows the same reasoning as `lib/standings/cache.ts`: at the scale this
 * platform is for, recomputing everything is cheaper than invalidating
 * anything precisely.
 *
 * The rule that makes this safe: **authorisation never reads the snapshot.**
 * A suspension has to take effect on the next request, so anything deciding
 * whether somebody may act calls `getAccount` and reads one row by primary
 * key. What the snapshot serves is presentation — the display name next to a
 * submission — and cohort membership when building a contest's participant
 * list. Both tolerate being a few seconds stale; neither grants access.
 *
 * Writes go through `lib/accounts/queries.ts`, which invalidates. The TTL is
 * the backstop for a second process having done the writing.
 *
 * There was a `displayNameFor(handle)` here that fell back to the bare handle,
 * left over from when the roster was a compile-time Map and a name could be
 * looked up one at a time. Nothing called it: the callers that survived the
 * move ask for the whole map once and index it, because a page that resolves
 * names one await at a time is the shape this cache exists to avoid.
 */
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

  // Collapse concurrent misses so a burst of viewers triggers one query.
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

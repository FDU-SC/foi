import type { Viewer } from "@/lib/permissions/viewer";
import type { AccountRow, AccountStatus } from "@/lib/db/schema";
import { listAccounts } from "./queries";
import { listPendingTokens } from "./tokens";

/**
 * How the operations console obtains account data.
 *
 * `proxy.ts` is a real gate but a routing one: it protects a URL prefix, and
 * the note in `app/(site)/admin/actions.ts` records why that is not enough for
 * writes. Reads need the same second answer, or a mistake in the matcher
 * exposes the directory with nothing else to catch it.
 *
 * This is also the one part of the console that shows personal data rather
 * than platform state, which is why it answers to `account.read` rather than
 * to `admin.access`.
 */

export interface AccountDirectory {
  /**
   * Whether an account has a password, and when it was last set, ride along
   * on the row as `passwordSetAt` — there is no second list to join against
   * since the two tables became one.
   */
  accounts: AccountRow[];
  /** Handles with a password reset link still outstanding. */
  awaitingReset: Set<string>;
}

const EMPTY: AccountDirectory = {
  accounts: [],
  awaitingReset: new Set(),
};

/**
 * The account directory, or nothing at all.
 *
 * Empty rather than an exception, matching the other access layers: a page
 * that somehow reaches this without the capability renders an empty console
 * instead of a stack trace, and there is no partial state to reason about.
 */
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

/** Just the accounts, for the pages that only count them. */
export async function accountsFor(
  viewer: Viewer,
  options?: { status?: AccountStatus },
): Promise<AccountRow[]> {
  if (!viewer.can("account.read")) return [];
  return listAccounts(options);
}

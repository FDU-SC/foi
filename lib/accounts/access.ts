import type { Viewer } from "@/lib/auth/viewer";
import { listCredentials, type CredentialState } from "@/lib/auth/credentials";
import { listPendingTokens } from "@/lib/auth/tokens";
import type { AccountRow, AccountStatus } from "@/lib/db/schema";
import { listAccounts } from "./queries";

/**
 * How the operations console obtains account data.
 *
 * The console's reads were the last thing still guarded only by `proxy.ts`.
 * That is a real gate, but it is a routing gate: it protects a URL prefix, and
 * the note in `app/(site)/admin/actions.ts` already records why that is not
 * enough for writes — a Server Action is reachable by POST whatever the
 * matcher matched. Reads had no equivalent second answer, so a mistake in the
 * matcher would have exposed the directory with nothing else to catch it.
 *
 * This is also the one part of the console that shows personal data rather
 * than platform state, which is why it answers to `account.read` rather than
 * to `admin.access`.
 */

export interface AccountDirectory {
  accounts: AccountRow[];
  credentials: CredentialState[];
  /** Handles with a password reset link still outstanding. */
  awaitingReset: Set<string>;
}

const EMPTY: AccountDirectory = {
  accounts: [],
  credentials: [],
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

  const [accounts, credentials, pending] = await Promise.all([
    listAccounts(),
    listCredentials(),
    listPendingTokens("password_reset"),
  ]);

  return {
    accounts,
    credentials,
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

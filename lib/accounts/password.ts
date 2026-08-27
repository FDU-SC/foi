import { hash, verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import ARGON2_OPTIONS from "./argon2-options.cjs";
import type { DbOrTx } from "./queries";
import { normalizeHandle } from "./types";

/**
 * The one column of `accounts` that is a secret, and the only code allowed to
 * read it.
 *
 * Everything else reaches accounts through `accountColumns`, which subtracts
 * the hash — so the boundary is not a convention about who remembers to be
 * careful but the shape of what the other queries return. The two functions
 * here that touch `passwordHash` name it explicitly, and they are short
 * enough to check by eye.
 *
 * Single-use codes are `lib/accounts/tokens.ts`, not here.
 *
 * The argon2 parameters live in `./argon2-options.cjs` rather than as a
 * constant in this file: `scripts/create-account.cjs` writes hashes
 * `verifyPassword` has to accept and cannot read a `.ts`. The `.cjs` is still
 * this module's — the tool imports it, not the other way round.
 */

/**
 * A real hash, verified against when no password is on file, so a handle with
 * no password costs the same wall time as a wrong one.
 */
const decoyHash = hash("decoy-for-constant-time-login", ARGON2_OPTIONS);

/** Local to this module: `setPassword` is the only way a hash gets written. */
function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export type PasswordCheck = { ok: true; setAt: Date } | { ok: false };

/**
 * Constant-time regardless of whether the handle has a password on file.
 *
 * Reports `setAt` on success — the `passwordSetAt` of the row whose hash just
 * matched — because that is the value the session gets pinned to, and it came
 * back with the hash for free. Reading it in a second query instead would open
 * a window where a reset lands between the two and the brand-new session is
 * born already stale.
 *
 * Both columns are required for a pass. The check constraint on the table
 * makes them null together, so a row with one and not the other is a database
 * that has been edited by hand; treating it as a failure is the closed
 * direction and costs nothing that ever happens.
 */
export async function verifyPassword(
  handle: string,
  password: string,
): Promise<PasswordCheck> {
  const [row] = await db
    .select({
      passwordHash: accounts.passwordHash,
      passwordSetAt: accounts.passwordSetAt,
    })
    .from(accounts)
    .where(eq(accounts.handle, normalizeHandle(handle)))
    .limit(1);

  if (!row?.passwordHash || !row.passwordSetAt) {
    await verify(await decoyHash, password).catch(() => false);
    return { ok: false };
  }

  const matched = await verify(row.passwordHash, password).catch(() => false);
  return matched ? { ok: true, setAt: row.passwordSetAt } : { ok: false };
}

/**
 * When the password behind this handle was last written, or null if there is
 * none on file.
 *
 * Read on every authenticated request by `getResolvedUser`, and the reason a
 * password reset actually ends the sessions it was meant to end. It is the
 * price of a JWT that carries no server-side state to revoke — though it is
 * now a second column of a row the caller is already reading rather than a
 * second table.
 */
export async function passwordSetAt(handle: string): Promise<Date | null> {
  const [row] = await db
    .select({ passwordSetAt: accounts.passwordSetAt })
    .from(accounts)
    .where(eq(accounts.handle, normalizeHandle(handle)))
    .limit(1);

  return row?.passwordSetAt ?? null;
}

/**
 * Whether a session issued against `passwordAt` still matches the password
 * now on file.
 *
 * Both failures are closed. A missing timestamp leaves nothing to match
 * against; one written after the session was issued means the password has
 * changed since, and the session belongs to the old one. Equal timestamps
 * pass: that is a session minted from exactly this row, which is every session
 * at the moment it is created.
 */
export function sessionMatchesPassword(
  setAt: Date | null,
  passwordAt: number,
): boolean {
  if (!setAt) return false;
  return setAt.getTime() <= passwordAt;
}

/**
 * Writes a password onto an account that already exists.
 *
 * Throws when it does not. That used to be the foreign key's job — a password
 * with nobody behind it could never be used, so the row simply could not be
 * written — and merging the tables took the constraint away without taking
 * away the mistake: an `update` naming a handle nobody registered matches no
 * rows and reports success, leaving a caller believing it set a password that
 * does not exist. The registration transaction is the one that would notice
 * last.
 *
 * Takes an optional `DbOrTx` so registration and password reset can commit the
 * account row and its password together. The hash is computed before the
 * statement either way, which means a caller in a transaction holds its
 * connection through the argon2 work. Splitting this into a hash half and a
 * write half would avoid that, at the price of a second exported way to put a
 * hash in the table — and the connection is the cheaper of the two.
 *
 * Does not invalidate the snapshot in `./cache.ts`, unlike the writes in
 * `./queries.ts`. That snapshot holds display names, addresses and statuses;
 * no reader of it can see a password, so there is nothing here to go stale.
 *
 * `passwordSetAt` is written by the database and not by this process — see the
 * note on the column for why the clock has to be the same one on both sides of
 * every comparison it feeds.
 */
export async function setPassword(
  handle: string,
  password: string,
  on: DbOrTx = db,
): Promise<void> {
  const normalized = normalizeHandle(handle);
  const passwordHash = await hashPassword(password);

  const [row] = await on
    .update(accounts)
    .set({ passwordHash, passwordSetAt: sql`now()` })
    .where(eq(accounts.handle, normalized))
    .returning({ handle: accounts.handle });

  if (!row) throw new Error(`账号 ${normalized} 不存在，无法设置密码`);
}

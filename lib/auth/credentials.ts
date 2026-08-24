import { hash, verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/accounts/queries";
import { normalizeHandle } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { credentials } from "@/lib/db/schema";
import ARGON2_OPTIONS from "@/scripts/argon2-options.cjs";

/**
 * Everything that touches the one secret the repository cannot hold.
 *
 * A credentials row says nothing about who someone is or what they may do —
 * `accounts` answers the first and `content/enrollment/` the second. It only
 * answers "has this handle been given a way to log in on this deployment",
 * which is why the module deals in handles and never in identities.
 *
 * Single-use codes used to live here too. They are in `lib/auth/tokens.ts`
 * now: once a person can be sent an email, verifying an address and resetting
 * a password are the same mechanism as the setup code, and there can be more
 * than one of them outstanding at a time.
 *
 * The argon2 parameters are imported from `scripts/argon2-options.cjs` rather
 * than declared here, even though this is the module that owns the decision.
 * The operational scripts write hashes `verifyPassword` has to accept and
 * cannot read a `.ts`, so the only file all four callers can share is a `.cjs`
 * one — see the comment there.
 */

/**
 * A real hash, verified against when no password is on file, so a handle with
 * no credentials costs the same wall time as a wrong password.
 */
const decoyHash = hash("decoy-for-constant-time-login", ARGON2_OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export type PasswordCheck = { ok: true; setAt: Date } | { ok: false };

/**
 * Constant-time regardless of whether the handle has a password on file.
 *
 * Reports `setAt` on success — the `updatedAt` of the row whose hash just
 * matched — because that is the value the session gets pinned to, and it came
 * back with the hash for free. Reading it in a second query instead would open
 * a window where a reset lands between the two and the brand-new session is
 * born already stale.
 */
export async function verifyPassword(
  handle: string,
  password: string,
): Promise<PasswordCheck> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.handle, normalizeHandle(handle)))
    .limit(1);

  if (!row?.passwordHash) {
    await verify(await decoyHash, password).catch(() => false);
    return { ok: false };
  }

  const matched = await verify(row.passwordHash, password).catch(() => false);
  return matched ? { ok: true, setAt: row.updatedAt } : { ok: false };
}

/**
 * When the password behind this handle was last written, or null if there is
 * none on file.
 *
 * Read on every authenticated request by `getResolvedUser`, and the reason a
 * password reset actually ends the sessions it was meant to end. It costs a
 * second indexed lookup on top of the account row — the price of a JWT that
 * carries no server-side state to revoke.
 */
export async function passwordSetAt(handle: string): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: credentials.updatedAt })
    .from(credentials)
    .where(eq(credentials.handle, normalizeHandle(handle)))
    .limit(1);

  return row?.updatedAt ?? null;
}

/**
 * Whether a session issued against `credentialsAt` still matches the password
 * now on file.
 *
 * Both failures are closed. A missing row leaves nothing to match against; a
 * row written after the session was issued means the password has changed
 * since, and the session belongs to the old one. Equal timestamps pass: that
 * is a session minted from exactly this row, which is every session at the
 * moment it is created.
 */
export function sessionMatchesPassword(
  setAt: Date | null,
  credentialsAt: number,
): boolean {
  if (!setAt) return false;
  return setAt.getTime() <= credentialsAt;
}

/**
 * Writes a password for a handle that already has an account.
 *
 * The foreign key enforces that: a password with nobody behind it could never
 * be used, and letting one exist is how the old schema ended up with orphan
 * rows nobody could account for.
 *
 * Takes an optional `DbOrTx` so registration and password reset can commit the
 * account row and its password together. The hash is computed before the
 * statement either way, which means a caller in a transaction holds its
 * connection through the argon2 work. Splitting this into a hash half and a
 * write half would avoid that, at the price of a second exported way to put a
 * hash in the table — and the connection is the cheaper of the two.
 */
export async function setPassword(
  handle: string,
  password: string,
  on: DbOrTx = db,
): Promise<void> {
  const normalized = normalizeHandle(handle);
  const passwordHash = await hashPassword(password);

  await on
    .insert(credentials)
    .values({ handle: normalized, passwordHash })
    .onConflictDoUpdate({
      target: credentials.handle,
      set: {
        passwordHash: sql`excluded.password_hash`,
        updatedAt: new Date(),
      },
    });
}

export interface CredentialState {
  handle: string;
  hasPassword: boolean;
  updatedAt: Date;
}

export async function listCredentials(): Promise<CredentialState[]> {
  const rows = await db.select().from(credentials);

  return rows
    .map((row) => ({
      handle: row.handle,
      hasPassword: row.passwordHash !== null,
      updatedAt: row.updatedAt,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

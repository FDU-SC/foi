import { hash, verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { normalizeHandle } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { credentials } from "@/lib/db/schema";

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
 */

// Argon2id with parameters in line with the OWASP baseline.
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A real hash, verified against when no password is on file, so a handle with
 * no credentials costs the same wall time as a wrong password.
 */
const decoyHash = hash("decoy-for-constant-time-login", ARGON2_OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Constant-time regardless of whether the handle has a password on file. */
export async function verifyPassword(
  handle: string,
  password: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.handle, normalizeHandle(handle)))
    .limit(1);

  if (!row?.passwordHash) {
    await verify(await decoyHash, password).catch(() => false);
    return false;
  }
  return verify(row.passwordHash, password).catch(() => false);
}

/**
 * Writes a password for a handle that already has an account.
 *
 * The foreign key enforces that: a password with nobody behind it could never
 * be used, and letting one exist is how the old schema ended up with orphan
 * rows nobody could account for.
 */
export async function setPassword(
  handle: string,
  password: string,
): Promise<void> {
  const normalized = normalizeHandle(handle);
  const passwordHash = await hashPassword(password);

  await db
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

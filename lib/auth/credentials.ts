import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { credentials } from "@/lib/db/schema";
import { normalizeHandle } from "@/lib/roster/types";

/**
 * Everything that touches the one secret the repository cannot hold.
 *
 * A credentials row says nothing about who someone is or what they may do —
 * that is the roster's job. It only answers "has this handle been given a way
 * to log in on this deployment", which is why the module deals in handles and
 * never in identities.
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

const SETUP_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Setup codes are 160 bits of randomness, so a fast digest is enough — there
 * is no low-entropy secret here for an attacker to grind against.
 */
function digest(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function getRow(handle: string) {
  const [row] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.handle, normalizeHandle(handle)))
    .limit(1);
  return row;
}

/** Constant-time regardless of whether the handle has a password on file. */
export async function verifyPassword(
  handle: string,
  password: string,
): Promise<boolean> {
  const row = await getRow(handle);
  if (!row?.passwordHash) {
    await verify(await decoyHash, password).catch(() => false);
    return false;
  }
  return verify(row.passwordHash, password).catch(() => false);
}

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
        // Redeeming or replacing a password retires any outstanding code.
        setupCodeHash: null,
        setupExpiresAt: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Issues a single-use code that lets its holder choose their own password.
 *
 * This is how someone added to the roster gets in for the first time, and how
 * a forgotten password is recovered. The plaintext is returned once and never
 * stored; only its digest is persisted.
 */
export async function issueSetupCode(
  handle: string,
  ttlMs: number = SETUP_CODE_TTL_MS,
): Promise<{ code: string; expiresAt: Date }> {
  const normalized = normalizeHandle(handle);
  const code = randomBytes(20).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .insert(credentials)
    .values({
      handle: normalized,
      setupCodeHash: digest(code),
      setupExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: credentials.handle,
      set: {
        setupCodeHash: sql`excluded.setup_code_hash`,
        setupExpiresAt: sql`excluded.setup_expires_at`,
        updatedAt: new Date(),
      },
    });

  return { code, expiresAt };
}

export type RedeemResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Exchanges a setup code for a password. An unknown handle and a wrong code
 * are reported identically so the endpoint cannot be used to enumerate who
 * has a pending invitation.
 */
export async function redeemSetupCode(
  handle: string,
  code: string,
  password: string,
): Promise<RedeemResult> {
  const row = await getRow(handle);
  if (!row?.setupCodeHash || !row.setupExpiresAt) {
    return { ok: false, reason: "invalid" };
  }
  if (!digestsMatch(row.setupCodeHash, digest(code))) {
    return { ok: false, reason: "invalid" };
  }
  if (row.setupExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  await setPassword(handle, password);
  return { ok: true };
}

export interface CredentialState {
  handle: string;
  hasPassword: boolean;
  /** Set only while an unexpired setup code is outstanding. */
  setupExpiresAt: Date | null;
  updatedAt: Date;
}

export async function listCredentials(): Promise<CredentialState[]> {
  const rows = await db.select().from(credentials);
  const now = Date.now();

  return rows
    .map((row) => ({
      handle: row.handle,
      hasPassword: row.passwordHash !== null,
      setupExpiresAt:
        row.setupExpiresAt && row.setupExpiresAt.getTime() > now
          ? row.setupExpiresAt
          : null,
      updatedAt: row.updatedAt,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

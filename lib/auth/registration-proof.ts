import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Binds "this address has been proven" to the browser that proved it.
 *
 * `isEmailVerified` is a fact about a mailbox, not about a person. The row
 * is keyed by the address, so once a code has been typed back anyone who
 * can POST the registration action may finish the form first and walk away
 * with the account — groups, contest entry and all — until the real owner
 * notices and resets the password. The cookie is what stops that: issued
 * only after a successful verify, required at register, and useless for
 * any other address.
 *
 * Signed rather than stored. The verification row already records that the
 * address was proven; this only has to record *who* did the proving, and
 * `AUTH_SECRET` is already the thing that binds a browser to an identity.
 */

export const REGISTRATION_PROOF_COOKIE = "foi_reg_proof";

/** Matches the verified-address TTL in `email-verification.ts`. */
export const REGISTRATION_PROOF_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error("AUTH_SECRET is not set");
  }
  return value;
}

function macFor(email: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${email}\n${exp}`).digest("hex");
}

function equalHex(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A proof that this browser just verified `email`. */
export function issueRegistrationProof(
  email: string,
  now = Date.now(),
): string {
  const exp = now + REGISTRATION_PROOF_TTL_MS;
  return `${exp}.${macFor(email, exp)}`;
}

/**
 * Whether `proof` was issued for this address and has not lapsed.
 *
 * Failures are interchangeable: a missing cookie, a cookie for a different
 * mailbox, a tampered mac and an expired one are all "this browser has not
 * proven that address". Distinguishing them would only help someone who is
 * probing.
 */
export function checkRegistrationProof(
  email: string,
  proof: string | undefined,
  now = Date.now(),
): boolean {
  if (!proof) return false;

  const dot = proof.indexOf(".");
  if (dot <= 0) return false;

  const exp = Number(proof.slice(0, dot));
  const mac = proof.slice(dot + 1);
  if (!Number.isFinite(exp) || exp <= now) return false;
  if (!/^[0-9a-f]{64}$/.test(mac)) return false;

  return equalHex(macFor(email, exp), mac);
}

export function registrationProofCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(REGISTRATION_PROOF_TTL_MS / 1000),
  };
}

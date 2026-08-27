import { createHmac, timingSafeEqual } from "node:crypto";

export const REGISTRATION_PROOF_COOKIE = "foi_reg_proof";

export const REGISTRATION_PROOF_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  return process.env.AUTH_SECRET!;
}

function macFor(email: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${email}\n${exp}`).digest("hex");
}

function equalHex(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueRegistrationProof(
  email: string,
  now = Date.now(),
): string {
  const exp = now + REGISTRATION_PROOF_TTL_MS;
  return `${exp}.${macFor(email, exp)}`;
}

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

function servedOverTls(): boolean {
  const base = process.env.FOI_PUBLIC_URL;
  if (!base) return false;
  try {
    return new URL(base).protocol === "https:";
  } catch {
    return false;
  }
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
    secure: servedOverTls(),
    path: "/",
    maxAge: Math.floor(REGISTRATION_PROOF_TTL_MS / 1000),
  };
}

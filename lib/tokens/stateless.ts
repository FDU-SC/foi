import { createHmac } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export type TokenPurpose = "email-verify" | "password-reset" | "email-change";

export interface TokenPayload {
  p: TokenPurpose;
  s: string;
  d?: unknown;
  fp?: string;
  exp: number;
}

const ALGORITHM = "HS256";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("Missing AUTH_SECRET environment variable");
  return s;
}

function key(): Uint8Array {
  return new TextEncoder().encode(secret());
}

/** A signed JWT whose audience is the purpose, so one kind never passes for another. */
export function issueToken(opts: {
  purpose: TokenPurpose;
  subject: string;
  data?: unknown;
  fingerprint?: string;
  ttlMs: number;
}): Promise<string> {
  return new SignJWT({
    ...(opts.data !== undefined && { d: opts.data }),
    ...(opts.fingerprint !== undefined && { fp: opts.fingerprint }),
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(opts.subject)
    .setAudience(opts.purpose)
    .setExpirationTime(Math.floor((Date.now() + opts.ttlMs) / 1000))
    .sign(key());
}

export async function verifyToken(
  raw: string,
  expectedPurpose: TokenPurpose,
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(raw, key(), {
      algorithms: [ALGORITHM],
      audience: expectedPurpose,
      requiredClaims: ["sub", "exp"],
    });
    return {
      p: expectedPurpose,
      s: payload.sub!,
      ...(payload.d !== undefined && { d: payload.d }),
      ...(typeof payload.fp === "string" && { fp: payload.fp }),
      exp: payload.exp!,
    };
  } catch {
    return null;
  }
}

export function fingerprint(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex").slice(0, 16);
}

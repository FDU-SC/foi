import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "email-verify" | "password-reset" | "email-change";

export interface TokenPayload {
  p: TokenPurpose;
  s: string;
  d?: unknown;
  fp?: string;
  exp: number;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("Missing AUTH_SECRET environment variable");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function verifySignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function issueToken(opts: {
  purpose: TokenPurpose;
  subject: string;
  data?: unknown;
  fingerprint?: string;
  ttlMs: number;
}): string {
  const payload: TokenPayload = {
    p: opts.purpose,
    s: opts.subject,
    ...(opts.data !== undefined && { d: opts.data }),
    ...(opts.fingerprint !== undefined && { fp: opts.fingerprint }),
    exp: Math.floor((Date.now() + opts.ttlMs) / 1000),
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyToken(
  raw: string,
  expectedPurpose: TokenPurpose,
): TokenPayload | null {
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const encoded = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  if (!verifySignature(encoded, signature)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as TokenPayload;
  } catch {
    return null;
  }

  if (payload.p !== expectedPurpose) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < Date.now() / 1000) return null;

  return payload;
}

export function fingerprint(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex").slice(0, 16);
}

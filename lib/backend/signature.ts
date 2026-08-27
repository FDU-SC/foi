import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-foi-timestamp";
export const SIGNATURE_HEADER = "x-foi-signature";

export const MAX_CLOCK_SKEW_SECONDS = 300;

export interface SignedRequest {
  method: string;

  path: string;

  body: string;
}

function canonical(timestamp: number, request: SignedRequest): string {
  return [
    String(timestamp),
    request.method.toUpperCase(),
    request.path,
    request.body,
  ].join("\n");
}

function digest(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function sign(
  secret: string,
  timestamp: number,
  request: SignedRequest,
): string {
  return digest(secret, canonical(timestamp, request));
}

function matches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifySignature(options: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  request: SignedRequest;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret, timestamp, signature, request } = options;
  if (!timestamp || !signature) return { ok: false, reason: "缺少签名头" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "时间戳格式错误" };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "时间戳超出允许范围" };
  }

  if (matches(sign(secret, ts, request), signature)) return { ok: true };

  return { ok: false, reason: "签名不匹配" };
}

export function signedHeaders(
  secret: string,
  request: SignedRequest,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: sign(secret, timestamp, request),
  };
}

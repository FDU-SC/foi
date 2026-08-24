import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-foi-timestamp";
export const SIGNATURE_HEADER = "x-foi-signature";

/** Replay window for both outbound requests and inbound callbacks. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Signs `<timestamp>.<body>` rather than the body alone, so a captured
 * request cannot be replayed outside the window with its original signature.
 */
export function sign(secret: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.${body}`);
  return `sha256=${mac.digest("hex")}`;
}

export function verifySignature(options: {
  secret: string;
  timestamp: string | null;
  body: string;
  signature: string | null;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret, timestamp, body, signature } = options;
  if (!timestamp || !signature) return { ok: false, reason: "缺少签名头" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "时间戳格式错误" };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "时间戳超出允许范围" };
  }

  const expected = Buffer.from(sign(secret, ts, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) {
    return { ok: false, reason: "签名不匹配" };
  }
  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "签名不匹配" };
  }

  return { ok: true };
}

export function signedHeaders(
  secret: string,
  body: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: sign(secret, timestamp, body),
  };
}

import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-foi-timestamp";
export const SIGNATURE_HEADER = "x-foi-signature";

/** Replay window for both outbound actions and inbound runner requests. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Everything about a request that the signature covers.
 *
 * The signature used to cover the body and nothing else, which left the two
 * fields that decide what a request *does* outside it. Two consequences, and
 * the second is the sharper one:
 *
 * The action a problem invokes travels in the path (`/action/spawn`), so
 * anything on the wire could rewrite it and the signature still verified. A
 * backend routing on the path rather than on `body.action` — which is what
 * `scripts/mock-backend.ts` does, and therefore what a backend author is
 * likely to copy — would then run `destroy` for a request signed as `poll`.
 *
 * Worse, a GET carries no body at all, so `<timestamp>.` was its entire
 * signing input: every empty-bodied request sharing a second shared one
 * signature. One captured pair of headers was a valid credential for every
 * other path — which is what makes this load-bearing in the direction traffic
 * runs now, where the empty-bodied GET is a runner asking for a job's contents
 * and the path is the only thing naming *which* job.
 *
 * So the path and the method are signed now, and the whitelist in
 * `lib/backend/actions.ts` is no longer the only thing standing between a path
 * segment and the backend.
 */
export interface SignedRequest {
  method: string;
  /** `pathname` + `search`, byte-identical to what goes on the wire. */
  path: string;
  /** Empty string for a request that has no body. */
  body: string;
}

/**
 * Newline-delimited rather than dot-delimited, because a dot appears in both
 * paths and bodies: `/action/a.b` with body `c` and `/action/a` with body `b.c`
 * would otherwise produce the same string, and one signature would cover both.
 *
 * That only moves the problem if a field can contain the delimiter, so: the
 * timestamp is decimal, the method comes from a fixed set, and every path
 * signed here is produced by the WHATWG URL parser, which strips tabs and
 * newlines from its input rather than encoding them. The body is last, so
 * whatever it holds cannot be read as a boundary. Should a path ever arrive
 * from somewhere other than that parser, this needs length prefixes instead.
 */
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

/**
 * The form this protocol used before the path and the method were covered.
 *
 * Never accepted — it exists so that a rejection can say which of the two
 * things went wrong. A backend that has not been upgraded and a backend
 * holding the wrong secret both fail with "signature does not match", and they
 * need opposite fixes.
 */
function legacyDigest(secret: string, timestamp: number, body: string): string {
  return digest(secret, `${timestamp}.${body}`);
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

  // Diagnosis only, and reached only once the request has already been
  // refused. Saying "still on the old signature format" costs one more HMAC
  // and saves an operator from checking a secret that was never wrong.
  if (matches(legacyDigest(secret, ts, request.body), signature)) {
    return {
      ok: false,
      reason:
        "签名用的是旧格式（只签了 body），未覆盖 method 与 path。请把题目后端升级到同一版本的签名规范。",
    };
  }

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

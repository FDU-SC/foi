import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-foi-timestamp";
export const SIGNATURE_HEADER = "x-foi-signature";

/** Replay window for both outbound actions and inbound runner requests. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Everything about a request that the signature covers.
 *
 * The method and the path are covered as well as the body, and both additions
 * are load-bearing. Cover the body alone and the two fields that decide what a
 * request *does* fall outside the signature.
 *
 * The action a problem invokes travels in the path (`/action/spawn`), so
 * anything on the wire could rewrite it and the signature would still verify.
 * A backend routing on the path rather than on `body.action` — which is what
 * this repository's reference runner does, and therefore what a backend author
 * is likely to copy — would then run `destroy` for a request signed as `poll`.
 *
 * Worse, a GET carries no body at all, so `<timestamp>.` would be its entire
 * signing input: every empty-bodied request sharing a second shares one
 * signature, and one captured pair of headers is a valid credential for every
 * other path. In the direction traffic runs, that empty-bodied GET is a runner
 * asking for a job's contents and the path is the only thing naming *which*
 * job.
 *
 * So the whitelist in `lib/problems/actions.ts` is not the only thing standing
 * between a path segment and the backend.
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

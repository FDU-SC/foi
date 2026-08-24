import { NextResponse } from "next/server";
import { rateLimit } from "./index";
import { SOURCE_GATE, type RouteKey } from "./policy";
import { isResolvedSource, sourceFrom } from "./source";

/**
 * The first line of every route handler under `/api`.
 *
 * These routes sit outside the `proxy.ts` matcher on purpose — proxy running
 * for a route makes Next clone and buffer the request body, which would turn
 * `readTextBody`'s streaming count into a cancel against a copy that has
 * already been paid for. Keeping them out preserves that defence and costs
 * them the global layer, so they take the equivalent bound here instead.
 *
 * Before anything, including reading the body and deciding who is calling.
 * `PUT /api/judge/callback` is why the ordering matters: it answers to nobody,
 * so its credentials are in the body and a header, and every byte of parsing
 * and every HMAC it computes is work an anonymous caller asked for.
 *
 * Returns a response to send, or null to carry on — so a call site that
 * forgets to return is a type error rather than a silently open endpoint.
 */
export function sourceGate(
  request: Request,
  route: RouteKey,
): NextResponse | null {
  const source = sourceFrom(request.headers);

  /**
   * No source, no gate — and this is not the cautious choice, it is the only
   * correct one.
   *
   * When nothing trusted sits in front, `sourceFrom` says so instead of
   * inventing an address. Counting everybody against one shared budget would
   * not be a weaker per-source bound, it would be a different control with a
   * much worse failure: on a tailnet staging box, four people polling a
   * submission would exhaust a per-minute allowance between them and lock each
   * other out. A flood cap that turns into an outage under ordinary use is
   * worse than no flood cap.
   *
   * Failing open here is also the right direction for what this is. It raises
   * the cost of volume; it is not what stops anybody doing anything. The bounds
   * that do that are keyed on an account and are unaffected — see
   * `./policy.ts`. A mis-set `FOI_TRUSTED_PROXY_HOPS` therefore loses the
   * flood cap rather than locking out every user, which is the failure worth
   * having.
   */
  if (!isResolvedSource(source)) return null;

  const verdict = rateLimit(
    `gate:${route}:${source}`,
    SOURCE_GATE.max,
    SOURCE_GATE.windowSeconds * 1000,
  );
  if (verdict.ok) return null;

  return NextResponse.json(
    { error: "请求过于频繁，请稍后再试" },
    {
      status: 429,
      headers: {
        "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)),
      },
    },
  );
}

/** The same refusal, for a bound taken after the caller is known. */
export function tooManyRequests(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "请求过于频繁，请稍后再试" },
    {
      status: 429,
      headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}

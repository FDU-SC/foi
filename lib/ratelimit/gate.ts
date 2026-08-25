import { NextResponse } from "next/server";
import { rateLimitBySource } from "./index";
import { ROUTE_LIMITS, SOURCE_GATE, type RouteKey } from "./policy";
import { sourceFrom } from "./source";

/**
 * The first line of every route handler under `/api`.
 *
 * These routes sit outside the `proxy.ts` matcher on purpose — proxy running
 * for a route makes Next clone and buffer the request body, which would turn
 * `readTextBody`'s streaming count into a cancel against a copy that has
 * already been paid for. Keeping them out preserves that defence and costs
 * them the global layer, so they take the equivalent bound here instead.
 *
 * Before anything, including reading the body and deciding who is calling. The
 * runner routes are why the ordering matters: they answer to no session, so
 * their credentials are a signature over the body, and every byte of parsing
 * and every HMAC computed is work an anonymous caller asked for.
 *
 * Two checks rather than one, and folded together rather than left as a line
 * each handler remembers. The cross-origin half was previously nowhere at all;
 * putting it beside the bound that is already unforgettable — because
 * `policy.test.ts` fails when a route is missing from the table — is what makes
 * it apply to the fourth route as reliably as to the first.
 *
 * Returns a response to send, or null to carry on — so a call site that
 * forgets to return is a type error rather than a silently open endpoint.
 */
export function guardRequest(
  request: Request,
  route: RouteKey,
): NextResponse | null {
  const flood = floodGate(request, route);
  if (flood) return flood;

  // After the bound rather than before it, so a stream of refused cross-origin
  // attempts still spends the source's budget. The order also keeps the
  // property the runner routes depend on: nothing above this line reads a body
  // or computes anything an anonymous caller chose the size of.
  return originGate(request, route);
}

function floodGate(request: Request, route: RouteKey): NextResponse | null {
  /**
   * Stands aside when no source can be established, and that decision is
   * `rateLimitBySource`'s rather than one taken again here.
   *
   * It used to be taken here, in a paragraph this file kept and the six Server
   * Actions did not — so the same `FOI_TRUSTED_PROXY_HOPS=0` meant "no gate"
   * on an API route and "one shared bucket for the whole deployment" on the
   * registration form. Two answers to one question is how a rule ends up
   * enforced in the place that happened to argue it.
   *
   * What is specific to this gate, and the reason it is the loss worth
   * accepting rather than a hole: these are the only bounds the three runner
   * endpoints and the health probe have, because none of them has an account
   * to count. The alternative would put every runner behind one address *and*
   * the compose probe into a single budget — and the probe curls localhost
   * from inside the container, so it resolves to no source at all and would be
   * among the first things refused. A 429 there reads as an unhealthy
   * container.
   */
  const verdict = rateLimitBySource(
    `gate:${route}`,
    sourceFrom(request.headers),
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

/**
 * The content types an HTML form can produce.
 *
 * This is the whole reason a content-type rule earns its place. A cross-origin
 * `fetch` that sets `application/json` is preflighted, and nothing here answers
 * a preflight, so the browser never sends it. A `<form>` is the one construct
 * that reaches another origin with a body of the author's choosing and no
 * preflight at all — and `enctype="text/plain"` shapes that body into something
 * `JSON.parse` accepts. Refuse these three and the form is out of moves.
 */
const FORM_CONTENT_TYPES = [
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

/**
 * The authority this request was actually addressed to.
 *
 * Compared against the `Origin` header instead of against `FOI_PUBLIC_URL`,
 * and that choice is the fix for a real regression: an earlier attempt used
 * exact equality with the configured URL, so reaching a dev server on
 * `127.0.0.1:3000` when it was configured as `localhost:3000` answered 403.
 * The question worth asking is not "is this the URL we published" but "did the
 * page that made this request come from the same place it is talking to", and
 * only the request can answer that.
 *
 * Believing the `Host` header is safe *for this question* even though it is
 * not safe for building links. An attacker who sets it picks the host their
 * own request is compared against, which gains them nothing: the session
 * cookie is host-only, so a browser sends it precisely when the host is ours,
 * and a caller forging the header from outside a browser has no cookie to
 * spend. Absolute URLs are a different matter and still come from
 * `FOI_PUBLIC_URL`.
 */
function requestHost(request: Request): string | null {
  const header = request.headers.get("host");
  if (header) return header.toLowerCase();

  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Refuses a state-changing request that a page on another origin set off.
 *
 * Hosts are compared, not full origins, because the scheme this process sees
 * is not the scheme the browser used: TLS terminates at the reverse proxy, so
 * a correct HTTPS deployment reports `http` internally and comparing schemes
 * would refuse every request it makes. Nothing is lost — cookies are not
 * isolated by scheme, so an attacker able to serve `http` on this exact host
 * already has the cookie without needing this route.
 */
function originGate(request: Request, route: RouteKey): NextResponse | null {
  if (ROUTE_LIMITS[route].guard !== "same-origin") return null;

  const forbidden = () =>
    NextResponse.json({ error: "请求来源不合法" }, { status: 403 });

  /**
   * A missing `Origin` is allowed through, and the content-type rule below is
   * what makes that safe rather than a hole.
   *
   * Browsers have sent `Origin` on every POST, same-origin ones included,
   * since Chrome 51 and Firefox 70 — so absent means the caller is not a
   * browser, which is a caller with no ambient cookie to abuse. Refusing it
   * would instead break `curl` against a dev server and every future
   * integration test, for a threat model in which no browser participates.
   */
  const origin = request.headers.get("origin");
  if (origin) {
    const host = requestHost(request);

    let sender: string;
    try {
      sender = new URL(origin).host.toLowerCase();
    } catch {
      return forbidden();
    }

    if (!host || sender !== host) return forbidden();
  }

  /**
   * Naming what is refused rather than what is allowed, which is the unusual
   * direction and the deliberate one here.
   *
   * The refused set is not a guess about what clients send, it is the CORS
   * safelist — fixed by the Fetch standard, and exactly the set that reaches
   * another origin without a preflight. Anything outside it is already
   * unreachable cross-origin, so demanding `application/json` instead would
   * only add a way to be wrong: an action taking no arguments is posted with no
   * body and therefore no content type, and making every problem author
   * remember a header that stops nothing is the class of rule this codebase
   * keeps having to delete.
   */
  const contentType = request.headers.get("content-type");
  if (!contentType) return null;

  const media = contentType.split(";")[0].trim().toLowerCase();
  if (!FORM_CONTENT_TYPES.includes(media)) return null;

  return NextResponse.json(
    { error: "请求的 Content-Type 不受支持" },
    { status: 415 },
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

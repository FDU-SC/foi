import { readTextBody } from "@/lib/body-limit";
import { envFragment } from "./env";
import { type ResolvedBackend } from "./resolve";
import { signedHeaders } from "./signature";
import { type BackendActionRequest } from "./types";

/**
 * The outbound half of the protocol.
 *
 * One call — `POST /action/<name>`, the half a backend cannot pull. Resolution
 * lives in `./resolve.ts` because both directions reach for it, and the queue
 * board in `./board.ts` because it reads two tables and makes no network call
 * at all.
 */

/**
 * How much of a backend's answer this process will hold.
 *
 * The timeout bounds how long a backend can keep the kernel waiting; without
 * this, nothing bounds how much it can make the kernel buffer, and `res.text()`
 * reads to completion — one backend answering with an endless body takes the
 * app down with it.
 *
 * Generous, because an action response is the problem's to define. A backend
 * that needs more than this is not returning a message, it is returning a file,
 * and that wants a URL rather than a relay.
 */
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * The kernel does not chase a backend's redirects.
 *
 * `fetch` defaults to `follow`, and Node will take up to twenty hops. That
 * turns the one outbound call left into a fetcher somebody else aims: a
 * compromised backend answers `302 Location: http://169.254.169.254/...` and
 * the kernel makes that request from inside the deployment's network and
 * relays the answer to whoever pressed the button. Nothing about the response
 * is inspected — that is the bargain of these endpoints — so the body would go
 * straight back to the player.
 *
 * `manual` rather than `error`, and the difference is only in what the kernel
 * can say afterwards. Neither follows the hop; `error` rejects with the same
 * `TypeError: fetch failed` that a DNS failure produces, so telling "the
 * backend is down" (503, worth retrying) apart from "the backend answered with
 * a redirect" (502, a misconfigured or hostile service) would come down to
 * matching on undici's wording. `manual` hands back the 3xx itself, which is a
 * fact this file can check and a test can reproduce.
 */
const NO_REDIRECT = "manual" as const;

/** A hop, per the fetch spec's own definition of a redirect status. */
function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * One place where a request to a backend is turned into a URL and its headers.
 *
 * The signature covers the path, so the path that gets signed has to be the
 * path that gets sent — resolved against the backend's base URL rather than
 * taken from the relative string, since a base URL carrying a path prefix
 * would otherwise sign one thing and request another.
 *
 * Throws on a backend with no address, which is now reachable configuration
 * rather than an impossibility: only backends a problem declares an action on
 * need one. `actionFor` has already established that this problem declared this
 * action, so getting here without an address means the deployment is running an
 * interactive problem it has not finished configuring, and saying which
 * variable is missing is more use than a fetch to `undefined`.
 */
function signedRequest(
  backend: ResolvedBackend,
  method: string,
  path: string,
  body: string,
): { url: URL; headers: Record<string, string> } {
  if (!backend.url) {
    throw new Error(
      `题目后端 "${backend.id}" 声明了交互动作但没有地址，请设置 FOI_BACKEND_${envFragment(backend.id)}_URL`,
    );
  }

  const url = new URL(path, backend.url);
  return {
    url,
    headers: signedHeaders(backend.secret, {
      method,
      path: url.pathname + url.search,
      body,
    }),
  };
}

/** What came back from an interactive endpoint, for relaying verbatim. */
export interface BackendActionResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * Media types an action response may be relayed as.
 *
 * The body stays opaque to the kernel — that is the whole bargain of these
 * endpoints. The header telling a browser how to interpret it is a different
 * thing, and passing the backend's own through meant a backend could answer
 * `text/html` and have the kernel serve it from the platform's origin. The
 * components that consume these endpoints call `res.json()`, so nothing renders
 * it today; the URL is reachable directly, so a link to it would.
 *
 * Signing the path narrows this — the response has to come from the action the
 * kernel actually invoked — but a compromised backend is exactly the case
 * where the kernel should not be lending out its origin.
 *
 * A whitelist rather than a blacklist, because the set of things a problem's
 * component needs is small and known, while the set of types a browser will
 * execute is neither.
 */
const RELAYABLE_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "application/octet-stream",
] as const;

/**
 * The declared type when it is one we relay, `application/octet-stream`
 * otherwise.
 *
 * Downgraded rather than refused. An action answering with something
 * unexpected is the problem author's to fix, and turning it into a 502 here
 * would break a working feature over a header — whereas serving the same bytes
 * under a type no browser renders costs the author nothing.
 */
function relayableContentType(header: string | null): string {
  if (!header) return "application/json";

  // Matched on the type alone; the parameters ride along, since `charset` is
  // the caller's business and only the type decides how a browser treats it.
  const type = header.split(";")[0].trim().toLowerCase();
  return (RELAYABLE_CONTENT_TYPES as readonly string[]).includes(type)
    ? header
    : "application/octet-stream";
}

/**
 * Invokes one interactive endpoint and hands the answer back untouched.
 *
 * Nothing here inspects the response. The kernel knows that `spawn` is a
 * string a problem declared and that whoever asked was allowed to; what comes
 * back belongs to the statement's own component, exactly as a verdict's
 * `detail` belongs to the problem rather than to the submission list.
 *
 * An unreachable backend becomes 503 rather than an exception, because the
 * caller's job is to relay a status code and a component showing "backend
 * unavailable" is more use to a player than a 500.
 */
export async function callBackendAction(
  backend: ResolvedBackend,
  request: BackendActionRequest,
): Promise<BackendActionResponse> {
  const body = JSON.stringify(request);
  const { url, headers } = signedRequest(
    backend,
    "POST",
    `/action/${encodeURIComponent(request.action)}`,
    body,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: NO_REDIRECT,
      signal: AbortSignal.timeout(backend.replyTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: timedOut ? "题目后端响应超时" : "无法连接题目后端",
      }),
    };
  }

  if (isRedirect(res.status)) {
    // Nothing will read the hop's own body, so let go of the socket rather
    // than leaving it to the collector.
    await res.body?.cancel().catch(() => {});
    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "题目后端返回了重定向" }),
    };
  }

  const read = await readTextBody(res, MAX_RESPONSE_BYTES);
  if (!read.ok) {
    // 502 rather than the backend's own status: the exchange did not complete,
    // and a component told "200, here is nothing" would render an empty
    // container as a working one.
    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "题目后端响应过大" }),
    };
  }

  return {
    status: res.status,
    contentType: relayableContentType(res.headers.get("content-type")),
    body: read.text,
  };
}

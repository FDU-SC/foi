/**
 * Reading a body without agreeing to hold all of it.
 *
 * `await request.text()` has no upper bound, so a route that calls it promises
 * to buffer whatever arrives before it has looked at a single header. Checking
 * the length afterwards reports the right status code from a process that has
 * already paid the whole cost.
 *
 * `PUT /api/runner/jobs/[id]` is the sharp case, because it is the one endpoint
 * here that answers to no session: its credentials are a signature over the
 * body, so the read happens before there is anything to authenticate against.
 * An anonymous PUT of 96 MiB moved that server's RSS by roughly half a
 * gigabyte before answering `400 请求体不是合法 JSON` — the server saying it
 * inspected a body it should never have accepted.
 *
 * Two bounds, because a body can lie about its size in either direction:
 * `content-length` is a claim worth refusing on when it is already over, and
 * the running total is what actually holds, since a chunked body declares no
 * length at all.
 *
 * Responses go through here too, which is why the parameter is a shape rather
 * than a `Request`. A problem backend is not a browser and not the kernel's to
 * trust: it is reached over the network and may be somebody else's service, so
 * handing what it returns to a bare `res.text()` is an unbounded read on every
 * interactive action a player triggers.
 */

/**
 * The largest body a Server Action will accept, wired into `next.config.ts`.
 *
 * Every form here is a handful of short fields — registration is the biggest,
 * at a handle, a display name, an address and two passwords — so Next's 1MB
 * default is headroom nobody asked for. This is a real limit: over it the
 * request is refused and the caller finds out.
 */
export const SERVER_ACTION_BODY_LIMIT = 64 * 1024;

/**
 * How much of a request body Next will hold when proxy runs for the route.
 *
 * A different kind of number from the one above, and that is why both are
 * spelled out. When proxy matches a route, Next clones the request body and
 * buffers it so proxy and the handler can each read it. Exceeding this bound
 * refuses nothing: the documented behaviour is to buffer the first N bytes,
 * log a warning, carry on, and *not* return an error to the client.
 *
 * So it has to sit **above** every legitimate body that can reach a proxied
 * route. Below one, a form submission at the allowed size arrives truncated —
 * the action gets half a body, fails to parse it, and reports a malformed
 * request. Corruption in the costume of user error, with only a server-side
 * warning to say otherwise. `body-limit.test.ts` pins the ordering.
 *
 * `proxy.ts` matches everything outside `/api` and the static assets, so this
 * governs **every** Server Action in the app, `login` and `registerAction`
 * among them — which is why the number above is the registration form's size
 * rather than an administrative one. Route handlers under `/api` are
 * deliberately outside the matcher: they count bytes off the stream with
 * `readTextBody` below, and buffering a clone first would take that away.
 */
export const PROXY_CLIENT_MAX_BODY_SIZE = 256 * 1024;

export type BodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too-large" };

/** A `Request` or a `Response`; both carry the two things this needs. */
interface TextBody {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
}

/**
 * Bytes, not `String.length`.
 *
 * `raw.length` counts UTF-16 code units, and every CJK character in a
 * submission is one unit and three bytes — so comparing against it lets a
 * 512 KiB cap admit 1.5 MiB of comments, with the number in the error message
 * not the number being enforced.
 */
export async function readTextBody(
  message: TextBody,
  maxBytes: number,
): Promise<BodyResult> {
  const declared = Number(message.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  const body = message.body;
  if (!body) return { ok: true, text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      // Drops the rest of the upload rather than draining it politely: the
      // sender is over budget and there is nothing further worth receiving.
      await reader.cancel();
      return { ok: false, reason: "too-large" };
    }

    chunks.push(value);
  }

  return { ok: true, text: Buffer.concat(chunks, total).toString("utf8") };
}

export type JsonBodyResult =
  | { ok: true; body: unknown; raw: string }
  | { ok: false; reason: "too-large" | "invalid-json" };

export async function readJsonBody(
  message: TextBody,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const read = await readTextBody(message, maxBytes);
  if (!read.ok) return { ok: false, reason: "too-large" };
  if (read.text.length === 0) return { ok: true, body: null, raw: "" };
  try {
    return { ok: true, body: JSON.parse(read.text), raw: read.text };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}

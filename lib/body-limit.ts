/**
 * Reading a body without agreeing to hold all of it.
 *
 * `await request.text()` has no upper bound. Every route that called it was
 * therefore promising to buffer whatever arrived before it had looked at a
 * single header, and the three that do it are the three that accept the
 * largest bodies. Checking the length afterwards — which is what they used to
 * do — reports the right status code from a process that has already paid the
 * whole cost.
 *
 * `/api/judge/callback` is the sharp case, because it is the one endpoint here
 * that answers to nobody: its credentials live in the body and in a header, so
 * the read happens before there is anything to authenticate against. An
 * anonymous PUT of 96 MiB moved that server's RSS by roughly half a gigabyte
 * and came back `400 请求体不是合法 JSON`, which is the server saying it
 * inspected the body it should never have accepted.
 *
 * Two bounds, because a body can lie about its size in either direction:
 * `content-length` is a claim worth refusing on when it is already over, and
 * the running total is what actually holds, since a chunked body declares no
 * length at all.
 *
 * Responses go through here too, which is why the parameter is a shape rather
 * than a `Request`. A problem backend is not a browser and not the kernel's to
 * trust: it is reached over the network, it may be somebody else's service,
 * and `lib/backend/client.ts` used to hand whatever it returned straight to
 * `res.text()` — an unbounded read on every dispatch, every action, and every
 * queue poll the reconciler makes.
 */

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
 * The old checks compared `raw.length`, which counts UTF-16 code units. Every
 * CJK character in a submission is one unit and three bytes, so a 512 KiB cap
 * admitted 1.5 MiB of comments, and the number in the error message was not
 * the number being enforced.
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

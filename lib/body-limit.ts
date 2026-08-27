export const SERVER_ACTION_BODY_LIMIT = 64 * 1024;

export const PROXY_CLIENT_MAX_BODY_SIZE = 256 * 1024;

export type BodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too-large" };

interface TextBody {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
}

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

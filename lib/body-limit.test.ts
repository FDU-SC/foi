import { describe, expect, it } from "vitest";
import {
  PROXY_CLIENT_MAX_BODY_SIZE,
  SERVER_ACTION_BODY_LIMIT,
  readTextBody,
} from "./body-limit";

/**
 * The two global ceilings fail in opposite ways, and the ordering between them
 * is the part that is not visible from either number alone.
 *
 * A Server Action over its limit is refused and the caller is told. A request
 * over the proxy buffer is silently truncated — a warning in the log, a
 * partial body to the handler, no error to the client. So the limit that
 * reports has to be the one that fires first. Backwards, a submission at
 * exactly the allowed size arrives cut short and is reported to the person as
 * a malformed request, which is an afternoon of debugging in the wrong place.
 */
describe("全局请求体上限", () => {
  it("proxy 的缓冲上限必须严格大于 Server Action 的上限", () => {
    expect(PROXY_CLIENT_MAX_BODY_SIZE).toBeGreaterThan(SERVER_ACTION_BODY_LIMIT);
  });

  it("两个值都是正整数字节数", () => {
    for (const value of [SERVER_ACTION_BODY_LIMIT, PROXY_CLIENT_MAX_BODY_SIZE]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  // Not a security bound, a sanity one: a limit large enough to stop being a
  // limit is worth noticing, and Next's own default already was.
  it("Server Action 的上限没有大到失去意义", () => {
    expect(SERVER_ACTION_BODY_LIMIT).toBeLessThanOrEqual(256 * 1024);
  });
});

/** A request whose body arrives in pieces, as a chunked upload does. */
function streamed(chunks: Uint8Array[], headers?: HeadersInit): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  return new Request("http://localhost/api/test", {
    method: "PUT",
    body,
    headers,
    // Required by undici for a streaming body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readTextBody", () => {
  it("放行没超上限的 body", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "PUT",
      body: "hello",
    });

    expect(await readTextBody(request, 1024)).toEqual({
      ok: true,
      text: "hello",
    });
  });

  it("没有 body 时给出空串", async () => {
    const request = new Request("http://localhost/api/test", { method: "GET" });

    expect(await readTextBody(request, 1024)).toEqual({ ok: true, text: "" });
  });

  it("拒绝超上限的 body", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "PUT",
      body: "x".repeat(2048),
    });

    expect(await readTextBody(request, 1024)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("按字节算，不按 UTF-16 码元算", async () => {
    // Nine characters, twenty-seven bytes. The old `raw.length` check counted
    // the nine and let a cap of ten through.
    const text = "中文九个字符哦哦哦";
    const body = () =>
      new Request("http://localhost/api/test", { method: "PUT", body: text });

    expect(await readTextBody(body(), 10)).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(await readTextBody(body(), 27)).toEqual({ ok: true, text });
  });

  it("content-length 已经超了就直接拒，不管真实 body 多小", async () => {
    // An over-declared length is refused on the header alone. Against a real
    // socket that is the whole point: nothing is read, so nothing is held.
    const request = new Request("http://localhost/api/test", {
      method: "PUT",
      body: "x",
      headers: { "content-length": "999999" },
    });

    expect(await readTextBody(request, 1024)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("分块上传在超限的那一块就停下，不等 body 结束", async () => {
    const chunk = new Uint8Array(64).fill(97);
    const chunks = Array.from({ length: 100 }, () => chunk);

    // No content-length at all, which is what a chunked upload looks like:
    // the running total is the only bound left.
    const result = await readTextBody(streamed(chunks), 128);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("同样能读 Response，后端答复走的是同一条路", async () => {
    // `lib/backend/client.ts` passes a `Response` here. Both shapes carry the
    // two things this needs, which is why the parameter is not a `Request`.
    const small = new Response("ok", { status: 200 });
    expect(await readTextBody(small, 1024)).toEqual({ ok: true, text: "ok" });

    const huge = new Response("x", {
      status: 200,
      headers: { "content-length": String(64 * 1024) },
    });
    expect(await readTextBody(huge, 1024)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("跨块的多字节字符不会被截坏", async () => {
    const encoded = new TextEncoder().encode("界");
    const chunks = [encoded.slice(0, 1), encoded.slice(1)];

    expect(await readTextBody(streamed(chunks), 1024)).toEqual({
      ok: true,
      text: "界",
    });
  });
});

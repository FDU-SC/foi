import { describe, expect, it } from "vitest";
import {
  PROXY_CLIENT_MAX_BODY_SIZE,
  SERVER_ACTION_BODY_LIMIT,
  readTextBody,
} from "./body-limit";

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

  it("Server Action 的上限没有大到失去意义", () => {
    expect(SERVER_ACTION_BODY_LIMIT).toBeLessThanOrEqual(256 * 1024);
  });
});

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

    const result = await readTextBody(streamed(chunks), 128);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("同样能读 Response，后端答复走的是同一条路", async () => {

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

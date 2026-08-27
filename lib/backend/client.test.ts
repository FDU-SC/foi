import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { callBackendAction } from "./client";
import { resolveBackend } from "./resolve";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "./signature";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const unaddressed = new Map<string, ProblemBackend>();

beforeEach(() => {
  vi.stubEnv("FOI_BACKEND_SECRET", "test-secret");

  for (const [id, entry] of Object.entries(backends)) {
    if (entry.url) continue;
    unaddressed.set(id, entry);
    backends[id] = { ...entry, url: `http://${id}.test` };
  }
});

afterEach(() => {
  for (const [id, entry] of unaddressed) backends[id] = entry;
  unaddressed.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("交互端点响应的 content-type 白名单", () => {
  const backend = () => resolveBackend(Object.keys(backends)[0]);
  const request = {
    action: "some-action",
    user: { uid: 1, groups: [] },
    problem: { slug: "some-problem", config: {} },
    contestSlug: null,
    payload: null,
  };

  function answeredWith(contentType: string | null) {
    const response = new Response("<script>alert(1)</script>", {
      status: 200,
      headers: contentType ? { "content-type": contentType } : {},
    });

    if (contentType === null) response.headers.delete("content-type");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    return callBackendAction(backend(), request);
  }

  it("放过 JSON，连 charset 一起保留", async () => {
    await expect(
      answeredWith("application/json; charset=utf-8"),
    ).resolves.toMatchObject({
      contentType: "application/json; charset=utf-8",
    });
  });

  it("放过 text/plain 与 octet-stream", async () => {
    await expect(answeredWith("text/plain")).resolves.toMatchObject({
      contentType: "text/plain",
    });
    await expect(
      answeredWith("application/octet-stream"),
    ).resolves.toMatchObject({ contentType: "application/octet-stream" });
  });

  it("text/html 降级成浏览器不会渲染的类型", async () => {
    await expect(answeredWith("text/html")).resolves.toMatchObject({
      contentType: "application/octet-stream",
    });
  });

  it("image/svg+xml 同样降级——它也能带脚本", async () => {
    await expect(answeredWith("image/svg+xml")).resolves.toMatchObject({
      contentType: "application/octet-stream",
    });
  });

  it("大小写与多余空格不能绕过匹配", async () => {
    await expect(
      answeredWith("  TEXT/HTML ; charset=utf-8"),
    ).resolves.toMatchObject({ contentType: "application/octet-stream" });
  });

  it("没有 content-type 时按 JSON 处理", async () => {
    await expect(answeredWith(null)).resolves.toMatchObject({
      contentType: "application/json",
    });
  });

  it("降级只动头，body 与状态码原样带回，因为它们归题目", async () => {
    await expect(answeredWith("text/html")).resolves.toMatchObject({
      body: "<script>alert(1)</script>",
      status: 200,
    });
  });
});

describe("后端响应的字节上限", () => {
  const backend = () => resolveBackend(Object.keys(backends)[0]);

  function oversized(): Response {
    return new Response("x".repeat(64), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(8 * 1024 * 1024),
      },
    });
  }

  it("交互端点响应过大时变成 502，而不是照抄 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(oversized());

    await expect(
      callBackendAction(backend(), {
        action: "some-action",
        user: { uid: 1, groups: [] },
        problem: { slug: "some-problem", config: {} },
        contestSlug: null,
        payload: null,
      }),
    ).resolves.toMatchObject({
      status: 502,
      contentType: "application/json",
    });
  });
});

describe("出站请求不跟随重定向", () => {
  const backend = () => resolveBackend(Object.keys(backends)[0]);
  const request = {
    action: "some-action",
    user: { uid: 1, groups: [] },
    problem: { slug: "some-problem", config: {} },
    contestSlug: null,
    payload: null,
  };

  function redirectTo(status: number, location: string): Response {
    return new Response("redirecting", {
      status,
      headers: { location, "content-type": "text/plain" },
    });
  }

  it("302 变成 502，而不是照抄后端的状态码与 body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      redirectTo(302, "http://169.254.169.254/latest/meta-data/"),
    );

    const response = await callBackendAction(backend(), request);

    expect(response.status).toBe(502);
    expect(response.contentType).toBe("application/json");
    expect(response.body).not.toContain("169.254.169.254");
  });

  it("整个 3xx 段都算，不只是 302", async () => {
    for (const status of [301, 303, 307, 308]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        redirectTo(status, "http://10.0.0.1/admin"),
      );

      await expect(
        callBackendAction(backend(), request),
      ).resolves.toMatchObject({ status: 502 });
    }
  });

  it("交给 fetch 的 redirect 模式不是跟随", async () => {
    let mode: RequestInit["redirect"] | "unset" = "unset";
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      mode = init?.redirect ?? "unset";
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    await callBackendAction(backend(), request);

    expect(mode).not.toBe("unset");
    expect(mode).not.toBe("follow");
  });

  it("正常的 2xx 不受影响", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await expect(callBackendAction(backend(), request)).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe("出站请求签的是它实际发出的 method 与 path", () => {
  const backendId = Object.keys(backends)[0];

  interface Sent {
    method: string;
    path: string;
    body: string;
    timestamp: string | null;
    signature: string | null;
  }

  function captureFetch(response: Response): () => Sent {
    let sent: Sent | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sent = {
        method: init?.method ?? "GET",
        path: url.pathname + url.search,
        body: typeof init?.body === "string" ? init.body : "",
        timestamp: headers[TIMESTAMP_HEADER] ?? null,
        signature: headers[SIGNATURE_HEADER] ?? null,
      };
      return Promise.resolve(response);
    });

    return () => {
      if (!sent) throw new Error("fetch 没有被调用");
      return sent;
    };
  }

  function verifyAsBackendWould(sent: Sent) {
    return verifySignature({
      secret: resolveBackend(backendId).secret,
      timestamp: sent.timestamp,
      signature: sent.signature,
      request: { method: sent.method, path: sent.path, body: sent.body },
    });
  }

  it("POST /action/<action>，动作名进了签名", async () => {
    const sent = captureFetch(jsonResponse({ ok: true }));

    await callBackendAction(resolveBackend(backendId), {
      action: "some-action",
      user: { uid: 1, groups: [] },
      problem: { slug: "some-problem", config: {} },
      contestSlug: null,
      payload: null,
    });

    expect(sent().path).toBe("/action/some-action");
    expect(verifyAsBackendWould(sent())).toEqual({ ok: true });

    expect(
      verifySignature({
        secret: resolveBackend(backendId).secret,
        timestamp: sent().timestamp,
        signature: sent().signature,
        request: {
          method: sent().method,
          path: "/action/destroy",
          body: sent().body,
        },
      }),
    ).toMatchObject({ ok: false });
  });
});

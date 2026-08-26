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

/**
 * Every declared backend gets an address for the duration of this file.
 *
 * These suites are about signing and about content types, and they used to get
 * an address for free: outside production the kernel filled an unconfigured
 * backend in with `http://localhost:4100`, the mock this repository happens to
 * ship. It no longer does — an address nobody configured reads as `undefined`
 * whatever `NODE_ENV` says — so the dependency is declared here instead of
 * inherited from a default that was one deployment's habit.
 */
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

/**
 * The body of an action response is opaque to the kernel; the header saying how
 * to interpret it is not. Relaying the backend's own `content-type` let a
 * backend answer `text/html` and have the kernel serve it from the platform's
 * origin.
 */
describe("交互端点响应的 content-type 白名单", () => {
  const backend = () => resolveBackend(Object.keys(backends)[0]);
  const request = {
    action: "some-action",
    user: { handle: "alice", groups: [] },
    problem: { slug: "some-problem", config: {} },
    contestSlug: null,
    payload: null,
  };

  function answeredWith(contentType: string | null) {
    const response = new Response("<script>alert(1)</script>", {
      status: 200,
      headers: contentType ? { "content-type": contentType } : {},
    });
    // `new Response` with a string body sets `text/plain` on its own, so the
    // "no content type at all" case has to be made by taking it back off.
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

/**
 * A backend is reached over the network and may be somebody else's service, so
 * how long it can keep the kernel waiting is bounded by a timeout and how much
 * it can make the kernel hold has to be bounded too. It was not: `res.text()`
 * and `res.json()` read to completion.
 */
describe("后端响应的字节上限", () => {
  const backend = () => resolveBackend(Object.keys(backends)[0]);

  /** Declares a length nothing will read, so the cap trips on the header. */
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
        user: { handle: "alice", groups: [] },
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

/**
 * A backend answering `302` is aiming the kernel, not answering it. `fetch`
 * follows redirects by default, so the one outbound call left would make the
 * next request from inside the deployment's network and relay the body back to
 * whoever pressed the button — an interactive endpoint turned into a fetcher
 * for the link-local metadata address.
 */
describe("出站请求不跟随重定向", () => {
  const backend = () => resolveBackend(Object.keys(backends)[0]);
  const request = {
    action: "some-action",
    user: { handle: "alice", groups: [] },
    problem: { slug: "some-problem", config: {} },
    contestSlug: null,
    payload: null,
  };

  /** What Node hands back for a 3xx when it is told not to chase it. */
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

  /**
   * The load-bearing half: the 502 above is only reachable because Node was
   * told not to take the hop itself. Left at the default `follow`, the kernel
   * would have made the second request before this file ever saw a status.
   */
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

/**
 * The signature covers the method and the path, so the one outbound call left
 * has to sign the request it actually makes. That pairing is the thing that can
 * come apart silently — change a path after signing it and the backend answers
 * 401 for a reason nothing here would have caught.
 *
 * So rather than asserting a particular canonical string, the case takes the
 * URL and headers `fetch` was handed and verifies one against the other.
 */
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
      user: { handle: "alice", groups: [] },
      problem: { slug: "some-problem", config: {} },
      contestSlug: null,
      payload: null,
    });

    expect(sent().path).toBe("/action/some-action");
    expect(verifyAsBackendWould(sent())).toEqual({ ok: true });

    // The point of signing the path: the same headers do not carry over to a
    // different action.
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

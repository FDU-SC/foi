import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backends } from "@/backends.config";
import {
  DispatchError,
  callBackendAction,
  dispatchToJudge,
  fetchAllJudgeQueues,
  fetchJudgeQueue,
  pollJudge,
  redactJudgeStatus,
  resolveBackend,
} from "./client";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifySignature,
} from "./signature";
import type { JudgeRequest } from "./types";

const QUEUE_BODY = {
  health: "ok",
  capacity: 4,
  running: 1,
  pending: 2,
  items: [
    {
      submissionId: "sub_1",
      problemSlug: "maze-runner",
      state: "running",
      enqueuedAt: "2026-08-22T01:46:24.000Z",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("FOI_BACKEND_SECRET", "test-secret");
  // The snapshot is process-wide on purpose; clear it so cases do not inherit
  // each other's sweep.
  globalThis.__foiQueueSnapshot = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.__foiQueueSnapshot = undefined;
});

describe("fetchAllJudgeQueues 快照", () => {
  it("一秒内的重复调用只打一轮判题机", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(QUEUE_BODY));

    await fetchAllJudgeQueues();
    const afterFirst = fetchMock.mock.calls.length;

    await fetchAllJudgeQueues();
    await fetchAllJudgeQueues();

    expect(afterFirst).toBe(Object.keys(backends).length);
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it("并发调用合流到同一轮，而不是各打一轮", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(QUEUE_BODY));

    await Promise.all([
      fetchAllJudgeQueues(),
      fetchAllJudgeQueues(),
      fetchAllJudgeQueues(),
      fetchAllJudgeQueues(),
    ]);

    expect(fetchMock.mock.calls.length).toBe(Object.keys(backends).length);
  });

  it("快照过期后重新拉取", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(QUEUE_BODY));

    await fetchAllJudgeQueues();
    const afterFirst = fetchMock.mock.calls.length;

    // Expire it rather than waiting a real second.
    if (globalThis.__foiQueueSnapshot) {
      globalThis.__foiQueueSnapshot.expiresAt = Date.now() - 1;
    }
    await fetchAllJudgeQueues();

    expect(fetchMock.mock.calls.length).toBe(afterFirst * 2);
  });

  it("单台判题机不可达不影响其余，也不抛异常", async () => {
    const ids = Object.keys(backends);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes(new URL(backends[ids[0]].url).port)) {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      }
      return Promise.resolve(jsonResponse(QUEUE_BODY));
    });

    const statuses = await fetchAllJudgeQueues();

    expect(statuses).toHaveLength(ids.length);
    expect(statuses.some((status) => !status.online)).toBe(true);
  });
});

describe("redactJudgeStatus", () => {
  it("抹掉判题机地址与队列条目的题目", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(QUEUE_BODY));
    const [status] = await fetchAllJudgeQueues();

    const redacted = redactJudgeStatus(status);

    expect(redacted.url).toBeNull();
    expect(redacted.queue?.items[0]).not.toHaveProperty("problemSlug");
  });

  it("保留 submissionId，选手要靠它找到自己的排队位次", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(QUEUE_BODY));
    const [status] = await fetchAllJudgeQueues();

    expect(redactJudgeStatus(status).queue?.items[0].submissionId).toBe("sub_1");
  });

  it("不改动原对象，因为它来自共享快照", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(QUEUE_BODY));
    const [status] = await fetchAllJudgeQueues();

    redactJudgeStatus(status);

    expect(status.url).not.toBeNull();
    expect(status.queue?.items[0].problemSlug).toBe("maze-runner");
  });
});

describe("dispatchToJudge 失败语义", () => {
  const judge = () => resolveBackend(Object.keys(backends)[0]);
  const request: JudgeRequest = {
    submissionId: "sub_1",
    user: { handle: "alice", groups: [] },
    problem: { slug: "maze-runner", config: {} },
    contestSlug: null,
    payload: {},
    callbackUrl: "http://localhost:3000/api/judge/callback",
    callbackToken: "token",
  };

  it("4xx 判为明确拒绝", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "bad request" }, 400),
    );

    await expect(dispatchToJudge(judge(), request)).rejects.toMatchObject({
      kind: "rejected",
    });
  });

  it("5xx 判为结果未知，因为判题机可能已经入队", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "boom" }, 503),
    );

    await expect(dispatchToJudge(judge(), request)).rejects.toMatchObject({
      kind: "unknown",
    });
  });

  it("连接失败判为结果未知", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );

    await expect(dispatchToJudge(judge(), request)).rejects.toMatchObject({
      kind: "unknown",
    });
  });

  it("超时判为结果未知", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeout);

    await expect(dispatchToJudge(judge(), request)).rejects.toMatchObject({
      kind: "unknown",
    });
  });

  it("accepted: false 判为明确拒绝，即便 HTTP 是 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ accepted: false }),
    );

    const error = await dispatchToJudge(judge(), request).catch((e) => e);
    expect(error).toBeInstanceOf(DispatchError);
    expect(error.kind).toBe("rejected");
  });

  it("正常受理时取回 judgeRef", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ accepted: true, judgeRef: "job-42" }),
    );

    await expect(dispatchToJudge(judge(), request)).resolves.toEqual({
      judgeRef: "job-42",
    });
  });

  it("没有 judgeRef 时返回 null 而不是报错", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ accepted: true }),
    );

    await expect(dispatchToJudge(judge(), request)).resolves.toEqual({
      judgeRef: null,
    });
  });
});

/**
 * The signature covers the method and the path, so every outbound call has to
 * sign the request it actually makes. That pairing is the thing that can come
 * apart silently — add a fifth endpoint, or change a path after signing it,
 * and the backend answers 401 for a reason nothing here would have caught.
 *
 * So rather than asserting a particular canonical string, each case takes the
 * URL and headers `fetch` was handed and verifies one against the other. A
 * call that signs anything other than what it sends fails.
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

  it("POST /judge", async () => {
    const sent = captureFetch(jsonResponse({ accepted: true, judgeRef: "j1" }));

    await dispatchToJudge(resolveBackend(backendId), {
      submissionId: "sub_1",
      user: { handle: "alice", groups: [] },
      problem: { slug: "maze-runner", config: {} },
      contestSlug: null,
      payload: {},
      callbackUrl: "http://localhost:3000/api/judge/callback",
      callbackToken: "token",
    });

    expect(sent().path).toBe("/judge");
    expect(verifyAsBackendWould(sent())).toEqual({ ok: true });
  });

  it("POST /action/<action>，动作名进了签名", async () => {
    const sent = captureFetch(jsonResponse({ ok: true }));

    await callBackendAction(resolveBackend(backendId), {
      action: "spawn",
      user: { handle: "alice", groups: [] },
      problem: { slug: "leaky-bucket", config: {} },
      contestSlug: null,
      payload: null,
    });

    expect(sent().path).toBe("/action/spawn");
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

  it("GET /queue，空 body 也绑在这个路径上", async () => {
    const sent = captureFetch(
      jsonResponse({ health: "ok", capacity: 1, running: 0, pending: 0 }),
    );

    await fetchJudgeQueue(backendId);

    expect(sent().path).toBe("/queue");
    expect(sent().body).toBe("");
    expect(verifyAsBackendWould(sent())).toEqual({ ok: true });
  });

  it("GET /status/<ref>，与 /queue 的签名不通用", async () => {
    const queue = captureFetch(
      jsonResponse({ health: "ok", capacity: 1, running: 0, pending: 0 }),
    );
    await fetchJudgeQueue(backendId);
    const queueSent = queue();

    const status = captureFetch(jsonResponse({ done: false }));
    await pollJudge(resolveBackend(backendId), "job-42");
    const statusSent = status();

    expect(statusSent.path).toBe("/status/job-42");
    expect(verifyAsBackendWould(statusSent)).toEqual({ ok: true });

    // Both have an empty body, which is exactly the pair that used to share
    // one signature.
    expect(queueSent.signature).not.toBe(statusSent.signature);
    expect(
      verifySignature({
        secret: resolveBackend(backendId).secret,
        timestamp: queueSent.timestamp,
        signature: queueSent.signature,
        request: { method: "GET", path: statusSent.path, body: "" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("judgeRef 里的斜杠被编码，签的和发的仍然一致", async () => {
    const sent = captureFetch(jsonResponse({ done: false }));

    await pollJudge(resolveBackend(backendId), "queue/1?x=2");

    expect(sent().path).toBe("/status/queue%2F1%3Fx%3D2");
    expect(verifyAsBackendWould(sent())).toEqual({ ok: true });
  });
});

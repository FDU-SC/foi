import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backends } from "@/backends.config";
import {
  DispatchError,
  dispatchToJudge,
  fetchAllJudgeQueues,
  redactJudgeStatus,
  resolveBackend,
} from "./client";

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
  const request = {
    submissionId: "sub_1",
    problem: { slug: "maze-runner", config: {} },
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

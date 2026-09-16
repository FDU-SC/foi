import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackSubmission } from "./track";
import type { SubmissionView } from "./types";

function view(state: SubmissionView["state"] = "queued"): SubmissionView {
  return {
    id: "sub_track", contestSlug: "round", problemSlug: "problem", state,
    result: null, detail: null, reason: null, runnerStatus: null,
    createdAt: "2026-09-16T00:00:00Z", judgedAt: null, queue: null,
  };
}

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class Source {
  static instances: Source[] = [];
  onmessage?: () => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() { Source.instances.push(this); }
}

const fetchMock = vi.fn<typeof fetch>();
const stops: (() => void)[] = [];
function track(onView = vi.fn(), onError = vi.fn()) {
  const stop = trackSubmission("sub_track", onView, onError);
  stops.push(stop);
  return { stop, onView, onError, source: Source.instances.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T00:00:00Z"));
  Source.instances = [];
  fetchMock.mockReset().mockImplementation(async () => Response.json(view()));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", Source);
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("提交跟踪", () => {
  it.each(["响应头", "响应体"])("%s 挂起时，20 秒后中止读取并继续重试", async (stage) => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(async (_url, init) => {
      signal = init!.signal!;
      const pending = new Promise<never>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      });
      if (stage === "响应头") return pending;
      const response = Response.json(view());
      vi.spyOn(response, "json").mockReturnValue(pending);
      return response;
    }).mockResolvedValueOnce(Response.json(view("completed")));
    const { onView, onError } = track();
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onView).toHaveBeenCalledExactlyOnceWith(view("completed"));
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("通知与轮询共享一个在途读取，密集通知合并为一次后续读取", async () => {
    const response = held<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const { source, onView } = track();
    await vi.advanceTimersByTimeAsync(800);
    for (let n = 0; n < 20; n++) source.onmessage?.();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onView).not.toHaveBeenCalled();
    response.resolve(Response.json(view()));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onView).toHaveBeenCalledWith(view());
  });

  it("SSE 只触发读取，连续读取至少间隔 800ms", async () => {
    const { source, onView } = track();
    source.onmessage?.();
    expect(onView).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    source.onmessage?.();
    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("取消中止请求，迟到的响应不会覆盖新的跟踪", async () => {
    const response = held<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const old = track();
    await vi.advanceTimersByTimeAsync(800);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    old.stop();
    old.stop();
    const current = track();
    response.resolve(Response.json(view("completed")));
    await vi.advanceTimersByTimeAsync(800);
    expect(signal?.aborted).toBe(true);
    expect(old.onView).not.toHaveBeenCalled();
    expect(old.source.close).toHaveBeenCalledTimes(1);
    expect(current.onView).toHaveBeenCalledWith(view());
  });

  it("取消发生在响应体解析期间也不发布状态", async () => {
    const body = held<SubmissionView>();
    const response = Response.json(view());
    vi.spyOn(response, "json").mockReturnValue(body.promise);
    fetchMock.mockResolvedValueOnce(response);
    const { stop, onView } = track();
    await vi.advanceTimersByTimeAsync(800);
    stop();
    body.resolve(view());
    await vi.advanceTimersByTimeAsync(0);
    expect(onView).not.toHaveBeenCalled();
  });

  it.each(["completed", "disrupted"] as const)("%s 终态只发布一次并释放资源", async (state) => {
    fetchMock.mockResolvedValueOnce(Response.json(view(state)));
    const { source, stop, onView } = track();
    await vi.advanceTimersByTimeAsync(800);
    source.onmessage?.();
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onView).toHaveBeenCalledExactlyOnceWith(view(state));
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["5", "Wed, 16 Sep 2026 00:00:05 GMT"])("通知不能绕过 Retry-After: %s", async (retryAfter) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": retryAfter } }));
    const { source } = track();
    source.onmessage?.();
    await vi.advanceTimersByTimeAsync(0);
    for (let n = 0; n < 4; n++) {
      await vi.advanceTimersByTimeAsync(1000);
      source.onmessage?.();
      source.onerror?.();
    }
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404])("%i 停止跟踪并提示", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    const { onError, source, onView } = track();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onView).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络错误与服务端故障后继续轮询，成功后仍可接收终态", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(view("completed")));
    const { onView, onError } = track();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    expect(onView).toHaveBeenCalledExactlyOnceWith(view("completed"));
  });

  it("没有 EventSource 时仍能轮询", async () => {
    vi.stubGlobal("EventSource", undefined);
    const onView = vi.fn();
    stops.push(trackSubmission("sub_track", onView, vi.fn()));
    await vi.advanceTimersByTimeAsync(800);
    expect(onView).toHaveBeenCalledWith(view());
  });
});

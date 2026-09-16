import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { viewerFor } from "@/lib/authz/viewer";
import { observeSubmission } from "./observe";
import { submissionStream } from "./stream";
import type { SubmissionView } from "./types";

vi.mock("./observe", () => ({ observeSubmission: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn() } }));

const initial: SubmissionView = {
  id: "sub_stream", contestSlug: "round", problemSlug: "problem", state: "queued",
  result: null, detail: null, reason: null, runnerStatus: null,
  createdAt: "2026-09-16T00:00:00Z", judgedAt: null, queue: null,
};
let observer: Parameters<typeof observeSubmission>[0];
let complete: () => void;
let fail: (error: unknown) => void;
const controllers: AbortController[] = [];

function stream() {
  const controller = new AbortController();
  controllers.push(controller);
  const onClose = vi.fn();
  const body = submissionStream({
    id: initial.id, viewer: viewerFor({ uid: 7, groups: [] }), initial,
    signal: controller.signal, onClose,
  });
  const reader = body.getReader();
  return { reader, onClose, controller };
}

async function text(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  return new TextDecoder().decode(chunk.value);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(observeSubmission).mockImplementation((options) => {
    observer = options;
    options.onView(options.initial);
    return new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  });
});

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
  vi.useRealTimers();
});

describe("提交事件流的资源上限", () => {
  it("下游没有读取时只保留最新快照，心跳不积累", async () => {
    const { reader } = stream();
    expect(await text(reader)).toBe("retry: 5000\n\n");
    for (let n = 0; n < 1000; n++) {
      observer.onView({ ...initial, runnerStatus: String(n) });
      observer.onHeartbeat();
    }
    expect(await text(reader)).toContain('"runnerStatus":"999"');
    const next = reader.read();
    observer.onView({ ...initial, state: "completed" });
    complete();
    expect(new TextDecoder().decode((await next).value)).toContain('"state":"completed"');
    expect(await reader.read()).toMatchObject({ done: true });
  });

  it("持续输出不能延长慢读期限，15 秒后取消观察并释放额度", async () => {
    const { reader, onClose } = stream();
    for (let n = 0; n < 14; n++) {
      await vi.advanceTimersByTimeAsync(1000);
      observer.onView({ ...initial, runnerStatus: String(n) });
    }
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(reader.read()).rejects.toThrow("读取超时");
    expect(observer.signal.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("下游持续读取时不会误断开长连接", async () => {
    const { reader, onClose } = stream();
    await text(reader);
    await text(reader);
    for (let n = 0; n < 4; n++) {
      const next = text(reader);
      await vi.advanceTimersByTimeAsync(20_000);
      observer.onHeartbeat();
      expect(await next).toBe(": ping\n\n");
    }
    expect(onClose).not.toHaveBeenCalled();
    await reader.cancel();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("终态等待读取期间仍有慢读期限", async () => {
    const { reader, onClose } = stream();
    await text(reader);
    observer.onView({ ...initial, state: "completed" });
    complete();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(reader.read()).rejects.toThrow("读取超时");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("按 UTF-8 字节限制单帧，超大结果不进入输出队列", async () => {
    const { reader, onClose } = stream();
    await text(reader);
    observer.onView({ ...initial, state: "completed", result: "字".repeat(750_000) });
    await expect(reader.read()).rejects.toThrow("大小限制");
    expect(observer.signal.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("下游取消与观察失败竞争时只释放一次", async () => {
    const { reader, onClose } = stream();
    await reader.cancel();
    fail(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(observer.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

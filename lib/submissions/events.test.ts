import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { subscribe } from "./events";

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    connect = vi.fn(async () => {});
    query = vi.fn(async (_command: string) => {});
    end = vi.fn(async () => { this.emit("end"); });
  }
  return { Client: vi.fn(function () { return new FakeClient(); }) };
});
vi.mock("@/lib/log", () => ({ log: { error: vi.fn() } }));

function held() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function client() {
  return vi.mocked(Client).mock.results.at(-1)!.value as Client;
}

const subscriptions: ReturnType<typeof subscribe>[] = [];
function watch(id = "sub_events", change = vi.fn(), error = vi.fn()) {
  const sub = subscribe(id, change, error);
  subscriptions.push(sub);
  return { ...sub, change, error };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://test/events");
});

afterEach(async () => {
  subscriptions.splice(0).forEach((sub) => sub.unsubscribe());
  await vi.advanceTimersByTimeAsync(0);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("提交事件订阅", () => {
  it("LISTEN 确认前不会就绪，首位订阅者取消不影响其他订阅者", async () => {
    const listening = held();
    const first = watch();
    const connection = client();
    vi.mocked(connection.query).mockImplementationOnce(() => listening.promise);
    const second = watch();
    const ready = vi.fn();
    void second.ready.then(ready);
    first.unsubscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(connection.query).toHaveBeenCalledExactlyOnceWith('LISTEN "foi:sub:sub_events"');
    listening.resolve();
    await second.ready;
    connection.emit("notification", { channel: "foi:sub:sub_events" });
    expect(first.change).not.toHaveBeenCalled();
    expect(second.change).toHaveBeenCalledTimes(1);
  });

  it("连接失败通知所有频道，后续订阅新建连接", async () => {
    const first = watch();
    const second = watch("sub_other");
    await Promise.all([first.ready, second.ready]);
    const broken = client();
    const error = new Error("lost");
    broken.emit("error", error);
    broken.emit("end");
    expect(first.error).toHaveBeenCalledExactlyOnceWith(error);
    expect(second.error).toHaveBeenCalledExactlyOnceWith(error);
    const next = watch();
    await next.ready;
    expect(client()).not.toBe(broken);
    expect(broken.end).toHaveBeenCalledTimes(1);
    client().emit("notification", { channel: "foi:sub:sub_events" });
    expect(next.change).toHaveBeenCalledTimes(1);
    expect(first.change).not.toHaveBeenCalled();
  });

  it("LISTEN 失败拒绝就绪并清理连接", async () => {
    const sub = watch();
    vi.mocked(client().query).mockRejectedValueOnce(new Error("listen failed"));
    await expect(sub.ready).rejects.toThrow("listen failed");
    expect(sub.error).toHaveBeenCalledTimes(1);
    expect(client().end).toHaveBeenCalledTimes(1);
  });

  it("最后一个订阅者在就绪前取消，确认后释放连接", async () => {
    const listening = held();
    const sub = watch();
    const connection = client();
    vi.mocked(connection.query).mockImplementationOnce(() => listening.promise);
    sub.unsubscribe();
    sub.unsubscribe();
    await vi.advanceTimersByTimeAsync(0);
    listening.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(sub.error).not.toHaveBeenCalled();
  });

  it("释放一个频道不打断其他频道，重新订阅排在 UNLISTEN 之后", async () => {
    const first = watch();
    const other = watch("sub_other");
    const connection = client();
    await Promise.all([first.ready, other.ready]);
    first.unsubscribe();
    await vi.advanceTimersByTimeAsync(0);
    const next = watch();
    await next.ready;
    expect(vi.mocked(connection.query).mock.calls.map(([query]) => query)).toEqual([
      'LISTEN "foi:sub:sub_events"', 'LISTEN "foi:sub:sub_other"',
      'UNLISTEN "foi:sub:sub_events"', 'LISTEN "foi:sub:sub_events"',
    ]);
    expect(connection.end).not.toHaveBeenCalled();
  });

  it("异步订阅回调的异常被交给错误回调", async () => {
    const error = new Error("subscriber failed");
    const sub = watch("sub_events", vi.fn(async () => { throw error; }));
    await sub.ready;
    client().emit("notification", { channel: "foi:sub:sub_events" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sub.error).toHaveBeenCalledExactlyOnceWith(error);
  });
});

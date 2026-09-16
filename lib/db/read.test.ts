import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { readSnapshot } from "./read";

const connect = vi.hoisted(() => vi.fn<() => Promise<PoolClient>>());
vi.mock("./index", () => ({ pool: { connect } }));

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let client: PoolClient;
beforeEach(() => {
  vi.useFakeTimers();
  client = Object.assign(new EventEmitter(), {
    query: vi.fn(async () => ({ rows: [], fields: [], rowCount: 0, command: "", oid: 0 })),
    release: vi.fn(),
  }) as unknown as PoolClient;
  connect.mockResolvedValue(client);
});
afterEach(() => { vi.useRealTimers(); });

describe("有时间预算的快照读取", () => {
  it("正常结束只归还一次连接，清除超时与取消监听", async () => {
    const controller = new AbortController();
    expect(await readSnapshot(async () => "read", controller.signal)).toBe("read");
    controller.abort();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
    expect(vi.getTimerCount()).toBe(0);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("整个读取超过 10 秒时销毁连接，迟到的结果不能归还它", async () => {
    const pending = held<string>();
    const read = readSnapshot(() => pending.promise);
    const rejected = expect(read).rejects.toThrow("读取超时");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    pending.resolve("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("取消在途读取时销毁连接并拒绝返回", async () => {
    const pending = held<string>();
    const controller = new AbortController();
    const read = readSnapshot(() => pending.promise, controller.signal);
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    pending.resolve("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("等待连接时已取消，迟到的连接会归还且不会执行查询", async () => {
    const pending = held<PoolClient>();
    connect.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const read = readSnapshot(async () => "unused", controller.signal);
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    pending.resolve(client);
    await rejected;
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
    expect(client.query).not.toHaveBeenCalled();
  });
});

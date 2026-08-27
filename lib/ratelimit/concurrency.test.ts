import { describe, expect, it } from "vitest";
import { createConcurrency } from "./concurrency";

describe("createConcurrency", () => {
  it("到上限为止都能拿到，之后拿不到", () => {
    const held = createConcurrency();

    expect(held.acquire("alice", 2)).not.toBeNull();
    expect(held.acquire("alice", 2)).not.toBeNull();
    expect(held.acquire("alice", 2)).toBeNull();
  });

  it("释放一个就能再拿一个", () => {
    const held = createConcurrency();

    const first = held.acquire("alice", 1);
    expect(held.acquire("alice", 1)).toBeNull();

    first!();

    expect(held.acquire("alice", 1)).not.toBeNull();
  });

  it("不同 key 各算各的", () => {
    const held = createConcurrency();

    held.acquire("alice", 1);

    expect(held.acquire("alice", 1)).toBeNull();
    expect(held.acquire("bob", 1)).not.toBeNull();
  });

  it("重复释放只算一次", () => {
    const held = createConcurrency();

    const release = held.acquire("alice", 2)!;
    held.acquire("alice", 2);
    expect(held.held("alice")).toBe(2);

    release();
    release();
    release();

    expect(held.held("alice")).toBe(1);
  });

  it("全部释放后不留下零计数的条目", () => {

    const held = createConcurrency();

    const release = held.acquire("alice", 1)!;
    release();

    expect(held.held("alice")).toBe(0);
  });
});

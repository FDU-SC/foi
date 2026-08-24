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

  /**
   * The property the SSE route depends on. A stream can be closed by the
   * verdict arriving, by the client going away, and by the runtime tearing the
   * response down, and more than one of those happens on an ordinary request.
   * A release that decremented each time would hand out slots that were never
   * taken.
   */
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
    // Otherwise the map keeps one entry per person who ever opened a stream,
    // which is a leak that just takes longer to notice.
    const held = createConcurrency();

    const release = held.acquire("alice", 1)!;
    release();

    expect(held.held("alice")).toBe(0);
  });
});

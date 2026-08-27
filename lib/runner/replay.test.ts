import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CLOCK_SKEW_SECONDS } from "@/lib/backend/signature";
import { createReplayWindow, REPLAY_TTL_MS } from "./replay";

afterEach(() => {
  vi.useRealTimers();
});

describe("createReplayWindow", () => {
  it("同一个 nonce 只认第一次", () => {
    const window = createReplayWindow({ maxKeys: 100 });

    expect(window.firstUse("queue-a", "n-1")).toBe(true);
    expect(window.firstUse("queue-a", "n-1")).toBe(false);
    expect(window.firstUse("queue-a", "n-1")).toBe(false);
  });

  it("不同的 nonce 互不影响", () => {
    const window = createReplayWindow({ maxKeys: 100 });

    expect(window.firstUse("queue-a", "n-1")).toBe(true);
    expect(window.firstUse("queue-a", "n-2")).toBe(true);
  });

  it("按后端分域，两个队列各记各的", () => {
    const window = createReplayWindow({ maxKeys: 100 });

    expect(window.firstUse("queue-a", "same")).toBe(true);
    expect(window.firstUse("queue-b", "same")).toBe(true);
    expect(window.firstUse("queue-a", "same")).toBe(false);
  });

  it("每个实例各持一份记录", () => {
    const a = createReplayWindow({ maxKeys: 100 });
    const b = createReplayWindow({ maxKeys: 100 });

    expect(a.firstUse("queue-a", "n")).toBe(true);
    expect(a.firstUse("queue-a", "n")).toBe(false);
    expect(b.firstUse("queue-a", "n")).toBe(true);
  });
});

describe("记忆时长", () => {
  it("覆盖到签名失效为止，也就是两倍的时钟偏移窗口", () => {
    expect(REPLAY_TTL_MS).toBe(2 * MAX_CLOCK_SKEW_SECONDS * 1000);
  });

  it("过了一倍偏移窗口仍然记得——那时签名还没失效", () => {
    vi.useFakeTimers();
    const window = createReplayWindow({ maxKeys: 100 });

    expect(window.firstUse("queue-a", "n")).toBe(true);

    vi.advanceTimersByTime(MAX_CLOCK_SKEW_SECONDS * 1000 + 1);

    expect(window.firstUse("queue-a", "n")).toBe(false);
  });

  it("签名再也验不过之后才忘掉，把位置让出来", () => {
    vi.useFakeTimers();
    const window = createReplayWindow({ maxKeys: 100 });

    expect(window.firstUse("queue-a", "n")).toBe(true);

    vi.advanceTimersByTime(REPLAY_TTL_MS + 1);

    expect(window.firstUse("queue-a", "n")).toBe(true);
  });
});

describe("key 数硬上限", () => {
  it("大量不同 nonce 也不会让记录越过上限", () => {
    const window = createReplayWindow({ maxKeys: 50 });

    for (let i = 0; i < 5_000; i += 1) {
      window.firstUse("queue-a", `nonce-${i}`);
    }

    expect(window.size()).toBeLessThanOrEqual(50);
  });

  it("先淘汰过期的，没过期的记录不受影响", () => {
    vi.useFakeTimers();
    const window = createReplayWindow({ maxKeys: 3, ttlMs: 1_000 });

    window.firstUse("queue-a", "short-a");
    window.firstUse("queue-a", "short-b");

    vi.advanceTimersByTime(900);
    window.firstUse("queue-a", "long");

    vi.advanceTimersByTime(200);
    window.firstUse("queue-a", "newcomer");

    expect(window.firstUse("queue-a", "long")).toBe(false);
  });

  it("挤满时不抛异常，也不停止记账", () => {
    const window = createReplayWindow({ maxKeys: 2 });

    for (let i = 0; i < 100; i += 1) {
      expect(() => window.firstUse("queue-a", `n${i}`)).not.toThrow();
    }

    expect(window.firstUse("queue-a", "steady")).toBe(true);
    expect(window.firstUse("queue-a", "steady")).toBe(false);
  });
});

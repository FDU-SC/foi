import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixedWindow } from "./window";

afterEach(() => {
  vi.useRealTimers();
});

describe("createFixedWindow", () => {
  it("每个实例各持一份计数，互不影响", () => {
    // The property `proxy.ts` depends on: it holds its own window rather than
    // joining the one on `globalThis`, because Next says proxy code must not
    // rely on shared globals.
    const a = createFixedWindow({ maxKeys: 100 });
    const b = createFixedWindow({ maxKeys: 100 });

    expect(a.take("k", 1, 60_000).ok).toBe(true);
    expect(a.take("k", 1, 60_000).ok).toBe(false);
    expect(b.take("k", 1, 60_000).ok).toBe(true);
  });

  it("窗口不随窗口内的请求延长", () => {
    vi.useFakeTimers();
    const window = createFixedWindow({ maxKeys: 100 });

    expect(window.take("k", 2, 1_000).ok).toBe(true);
    vi.advanceTimersByTime(900);
    expect(window.take("k", 2, 1_000).ok).toBe(true);
    // Fixed, not sliding: the window still ends 1000ms after the first
    // request, not 1000ms after the most recent one.
    vi.advanceTimersByTime(101);
    expect(window.take("k", 2, 1_000).ok).toBe(true);
  });

  /**
   * The key space belongs to whoever is calling, which for a source-keyed
   * counter means the internet. Sweeping expired entries is not enough on its
   * own, because a flood produces entries that have not expired yet.
   */
  describe("key 数硬上限", () => {
    it("大量不同 key 也不会让桶数越过上限", () => {
      const window = createFixedWindow({ maxKeys: 50 });

      for (let i = 0; i < 5_000; i += 1) {
        window.take(`source:${i}`, 10, 60_000);
      }

      expect(window.size()).toBeLessThanOrEqual(50);
    });

    it("先淘汰过期的，没过期的计数不受影响", () => {
      vi.useFakeTimers();
      const window = createFixedWindow({ maxKeys: 3 });

      // Two short-lived keys and one long-lived one.
      window.take("short-a", 1, 1_000);
      window.take("short-b", 1, 1_000);
      window.take("long", 1, 60_000);

      vi.advanceTimersByTime(1_500);

      // Room is made by dropping the two that have already expired, so the
      // live counter survives and still refuses.
      window.take("newcomer", 1, 60_000);

      expect(window.take("long", 1, 60_000).ok).toBe(false);
    });

    it("挤满时不抛异常，也不停止计数", () => {
      const window = createFixedWindow({ maxKeys: 2 });

      for (let i = 0; i < 100; i += 1) {
        expect(() => window.take(`k${i}`, 5, 60_000)).not.toThrow();
      }

      // Whatever survived eviction still counts.
      const k = "steady";
      expect(window.take(k, 2, 60_000).ok).toBe(true);
      expect(window.take(k, 2, 60_000).ok).toBe(true);
      expect(window.take(k, 2, 60_000).ok).toBe(false);
    });
  });
});

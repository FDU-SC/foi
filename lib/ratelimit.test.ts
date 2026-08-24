import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./ratelimit";

/** Unique per case, so cases cannot spend each other's budget. */
let counter = 0;
function key(): string {
  return `test:${(counter += 1)}:${Math.random()}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("放行到上限为止", () => {
    const k = key();

    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit(k, 3, 60_000).ok).toBe(true);
    }
    expect(rateLimit(k, 3, 60_000).ok).toBe(false);
  });

  it("被拒时给出还要等多久", () => {
    const k = key();
    rateLimit(k, 1, 60_000);

    const result = rateLimit(k, 1, 60_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("不同 key 各算各的", () => {
    const a = key();
    const b = key();

    rateLimit(a, 1, 60_000);

    expect(rateLimit(a, 1, 60_000).ok).toBe(false);
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);
  });

  it("窗口过去后重新放行", () => {
    vi.useFakeTimers();
    const k = key();

    expect(rateLimit(k, 1, 1_000).ok).toBe(true);
    expect(rateLimit(k, 1, 1_000).ok).toBe(false);

    vi.advanceTimersByTime(1_001);

    expect(rateLimit(k, 1, 1_000).ok).toBe(true);
  });

  it("计数器是进程内共享的，不随模块副本翻倍", async () => {
    const k = key();
    rateLimit(k, 1, 60_000);

    // A second import must land on the same bucket map.
    const again = await import("./ratelimit");
    expect(again.rateLimit(k, 1, 60_000).ok).toBe(false);
  });
});

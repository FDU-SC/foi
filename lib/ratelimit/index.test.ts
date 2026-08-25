import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit, rateLimitBySource } from "./index";

/** Unique per case, so cases cannot spend each other's budget. */
let counter = 0;
function key(): string {
  return `test:${(counter += 1)}:${Math.random()}`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
    const again = await import("./index");
    expect(again.rateLimit(k, 1, 60_000).ok).toBe(false);
  });
});

/**
 * The interesting half of a source-keyed bound is not the arithmetic above, it
 * is whether it counts at all.
 *
 * Six call sites used to build their own key out of the source string, so a
 * deployment with nothing trusted in front counted every caller against one
 * shared budget — ten registrations an hour for the whole site, not per
 * machine. The last case is the one that pins the fix down: it has to keep
 * letting the sentinel through past the limit, not merely let the first one
 * through.
 */
describe("rateLimitBySource", () => {
  it("来源解析得出时照常计数", () => {
    const activity = key();

    expect(rateLimitBySource(activity, "203.0.113.9", 1, 60_000).ok).toBe(true);
    expect(rateLimitBySource(activity, "203.0.113.9", 1, 60_000).ok).toBe(
      false,
    );
  });

  it("不同来源各算各的", () => {
    const activity = key();
    rateLimitBySource(activity, "203.0.113.9", 1, 60_000);

    expect(rateLimitBySource(activity, "198.51.100.4", 1, 60_000).ok).toBe(
      true,
    );
  });

  it("同一来源在不同 activity 下也各算各的", () => {
    rateLimitBySource(key(), "203.0.113.9", 1, 60_000);

    expect(rateLimitBySource(key(), "203.0.113.9", 1, 60_000).ok).toBe(true);
  });

  it("两个哨兵都整层让路，而不是共用一个桶", () => {
    const activity = key();

    for (const sentinel of ["direct", "unknown"]) {
      for (let i = 0; i < 20; i += 1) {
        expect(
          rateLimitBySource(activity, sentinel, 1, 60_000).ok,
          `${sentinel} 第 ${i + 1} 次被拒了，说明哨兵仍然被当成 key 在计数`,
        ).toBe(true);
      }
    }
  });
});

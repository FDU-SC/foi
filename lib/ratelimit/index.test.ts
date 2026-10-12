import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit, rateLimitBySource } from "./index";

let counter = 0;
function key(): string {
  return `test:${(counter += 1)}:${Math.random()}`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("rateLimit", () => {
  it("放行到上限为止", async () => {
    const k = key();

    for (let i = 0; i < 3; i += 1) {
      expect((await rateLimit(k, { max: 3, windowSeconds: 60 })).ok).toBe(true);
    }
    expect((await rateLimit(k, { max: 3, windowSeconds: 60 })).ok).toBe(false);
  });

  it("被拒时给出还要等多久", async () => {
    const k = key();
    await rateLimit(k, { max: 1, windowSeconds: 60 });

    const result = await rateLimit(k, { max: 1, windowSeconds: 60 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("不同 key 各算各的", async () => {
    const a = key();
    const b = key();

    await rateLimit(a, { max: 1, windowSeconds: 60 });

    expect((await rateLimit(a, { max: 1, windowSeconds: 60 })).ok).toBe(false);
    expect((await rateLimit(b, { max: 1, windowSeconds: 60 })).ok).toBe(true);
  });

  it("窗口过去后重新放行", async () => {
    vi.useFakeTimers();
    const k = key();

    expect((await rateLimit(k, { max: 1, windowSeconds: 1 })).ok).toBe(true);
    expect((await rateLimit(k, { max: 1, windowSeconds: 1 })).ok).toBe(false);

    vi.advanceTimersByTime(1_001);

    expect((await rateLimit(k, { max: 1, windowSeconds: 1 })).ok).toBe(true);
  });

  it("计数器是进程内共享的，不随模块副本翻倍", async () => {
    const k = key();
    await rateLimit(k, { max: 1, windowSeconds: 60 });

    const again = await import("./index");
    expect((await again.rateLimit(k, { max: 1, windowSeconds: 60 })).ok).toBe(
      false,
    );
  });
});

describe("rateLimitBySource", () => {
  it("来源解析得出时照常计数", async () => {
    const activity = key();

    expect(
      (await rateLimitBySource(activity, "203.0.113.9", { max: 1, windowSeconds: 60 })).ok,
    ).toBe(true);
    expect(
      (await rateLimitBySource(activity, "203.0.113.9", { max: 1, windowSeconds: 60 })).ok,
    ).toBe(false);
  });

  it("不同来源各算各的", async () => {
    const activity = key();
    await rateLimitBySource(activity, "203.0.113.9", { max: 1, windowSeconds: 60 });

    expect(
      (await rateLimitBySource(activity, "198.51.100.4", { max: 1, windowSeconds: 60 })).ok,
    ).toBe(true);
  });

  it("同一来源在不同 activity 下也各算各的", async () => {
    await rateLimitBySource(key(), "203.0.113.9", { max: 1, windowSeconds: 60 });

    expect(
      (await rateLimitBySource(key(), "203.0.113.9", { max: 1, windowSeconds: 60 })).ok,
    ).toBe(true);
  });

  it("两个哨兵都整层让路，而不是共用一个桶", async () => {
    const activity = key();

    for (const sentinel of ["direct", "unknown"]) {
      for (let i = 0; i < 20; i += 1) {
        expect(
          (await rateLimitBySource(activity, sentinel, { max: 1, windowSeconds: 60 })).ok,
          `${sentinel} 第 ${i + 1} 次被拒了，说明哨兵仍然被当成 key 在计数`,
        ).toBe(true);
      }
    }
  });
});

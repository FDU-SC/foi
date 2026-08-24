import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit, sourceFrom } from "./ratelimit";

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
    const again = await import("./ratelimit");
    expect(again.rateLimit(k, 1, 60_000).ok).toBe(false);
  });
});

/** What Caddy leaves behind: the peer it saw, appended to whatever arrived. */
function forwarded(chain: string): Headers {
  return new Headers({ "x-forwarded-for": chain });
}

describe("sourceFrom", () => {
  it("一层代理时取代理观察到的那一项", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "1");

    expect(sourceFrom(forwarded("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("调用方自己塞的 x-forwarded-for 不算数", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "1");

    // The sender wrote "1.2.3.4"; Caddy appended the address it actually saw.
    // Reading the left end — which is what this used to do — would have let
    // one machine present itself as an unlimited number of them.
    expect(sourceFrom(forwarded("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(sourceFrom(forwarded("a, b, c, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("同一台机器伪造不同首段，仍然落进同一个桶", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "1");

    const buckets = new Set(
      ["10.0.0.1", "10.0.0.2", "10.0.0.3"].map((forged) =>
        sourceFrom(forwarded(`${forged}, 203.0.113.9`)),
      ),
    );

    expect(buckets).toEqual(new Set(["203.0.113.9"]));
  });

  it("两层代理时再往回数一项", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "2");

    expect(sourceFrom(forwarded("1.2.3.4, 203.0.113.9, 10.1.1.1"))).toBe(
      "203.0.113.9",
    );
  });

  it("链条比配置的层数短就不猜，退回一个粗桶", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "2");

    expect(sourceFrom(forwarded("1.2.3.4"))).toBe("unknown");
  });

  it("填 0 表示前面没有代理，两个 header 都不看", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "0");

    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "5.6.7.8",
    });

    expect(sourceFrom(headers)).toBe("direct");
  });

  it("没配就按一层代理算", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", undefined);

    expect(sourceFrom(forwarded("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("配成非法值时退回一层，不是关掉", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "确实不是数字");

    expect(sourceFrom(forwarded("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("完全没有 x-forwarded-for 时才看 x-real-ip", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "1");

    expect(sourceFrom(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
    expect(sourceFrom(new Headers())).toBe("unknown");
  });
});

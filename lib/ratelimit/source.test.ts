import { afterEach, describe, expect, it, vi } from "vitest";
import { isResolvedSource, sourceFrom } from "./source";

afterEach(() => {
  vi.unstubAllEnvs();
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

/**
 * The sentinels have to be recognisable as "no source", not merely happen to
 * be unusual strings. A gate that keyed on them would put every caller in one
 * bucket, which is a different control from the one intended and a much worse
 * one — see the note in `./gate.ts`.
 */
describe("isResolvedSource", () => {
  it("真实地址算解析出来了", () => {
    expect(isResolvedSource("203.0.113.9")).toBe(true);
  });

  it("两个哨兵值都不算", () => {
    expect(isResolvedSource("direct")).toBe(false);
    expect(isResolvedSource("unknown")).toBe(false);
  });

  it("sourceFrom 在无代理与链条过短两种情形下都给出哨兵", () => {
    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "0");
    expect(isResolvedSource(sourceFrom(forwarded("1.2.3.4")))).toBe(false);

    vi.stubEnv("FOI_TRUSTED_PROXY_HOPS", "2");
    expect(isResolvedSource(sourceFrom(forwarded("1.2.3.4")))).toBe(false);
  });
});

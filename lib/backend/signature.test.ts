import { describe, expect, it } from "vitest";
import {
  MAX_CLOCK_SKEW_SECONDS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
  signedHeaders,
  verifySignature,
} from "./signature";

const SECRET = "0123456789abcdef0123456789abcdef";
const BODY = JSON.stringify({ submissionId: "sub_1", score: 100 });
const NOW = 1_800_000_000;

function verify(overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
  return verifySignature({
    secret: SECRET,
    timestamp: String(NOW),
    body: BODY,
    signature: sign(SECRET, NOW, BODY),
    now: NOW,
    ...overrides,
  });
}

describe("sign", () => {
  it("产出 sha256=<hex> 形状", () => {
    expect(sign(SECRET, NOW, BODY)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("时间戳参与签名，换一个就换一份签名", () => {
    expect(sign(SECRET, NOW, BODY)).not.toBe(sign(SECRET, NOW + 1, BODY));
  });

  it("body 参与签名", () => {
    expect(sign(SECRET, NOW, BODY)).not.toBe(sign(SECRET, NOW, `${BODY} `));
  });
});

describe("verifySignature", () => {
  it("接受自己签出来的请求", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("拒绝被篡改的 body", () => {
    expect(verify({ body: JSON.stringify({ score: 0 }) })).toMatchObject({
      ok: false,
    });
  });

  it("拒绝换了密钥的签名", () => {
    expect(verify({ signature: sign("another-secret", NOW, BODY) })).toMatchObject(
      { ok: false },
    );
  });

  it("缺少任一签名头都拒绝", () => {
    expect(verify({ timestamp: null })).toMatchObject({ ok: false });
    expect(verify({ signature: null })).toMatchObject({ ok: false });
  });

  it("拒绝非数字时间戳", () => {
    expect(verify({ timestamp: "not-a-number" })).toMatchObject({ ok: false });
  });

  it("长度不同的签名直接拒绝，不抛异常", () => {
    expect(() => verify({ signature: "sha256=short" })).not.toThrow();
    expect(verify({ signature: "sha256=short" })).toMatchObject({ ok: false });
  });
});

describe("verifySignature 重放窗口", () => {
  function atSkew(seconds: number) {
    const ts = NOW + seconds;
    return verifySignature({
      secret: SECRET,
      timestamp: String(ts),
      body: BODY,
      signature: sign(SECRET, ts, BODY),
      now: NOW,
    });
  }

  it("窗口边界之内通过", () => {
    expect(atSkew(MAX_CLOCK_SKEW_SECONDS)).toEqual({ ok: true });
    expect(atSkew(-MAX_CLOCK_SKEW_SECONDS)).toEqual({ ok: true });
  });

  it("超出窗口一秒即拒绝", () => {
    expect(atSkew(MAX_CLOCK_SKEW_SECONDS + 1)).toMatchObject({ ok: false });
    expect(atSkew(-MAX_CLOCK_SKEW_SECONDS - 1)).toMatchObject({ ok: false });
  });
});

describe("signedHeaders", () => {
  it("产出的头能被 verifySignature 直接接受", () => {
    const headers = signedHeaders(SECRET, BODY);

    expect(
      verifySignature({
        secret: SECRET,
        timestamp: headers[TIMESTAMP_HEADER],
        body: BODY,
        signature: headers[SIGNATURE_HEADER],
      }),
    ).toEqual({ ok: true });
  });

  it("带上 JSON content-type", () => {
    expect(signedHeaders(SECRET, BODY)["content-type"]).toBe("application/json");
  });
});

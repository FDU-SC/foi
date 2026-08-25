import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_CLOCK_SKEW_SECONDS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
  signedHeaders,
  verifySignature,
  type SignedRequest,
} from "./signature";

const SECRET = "0123456789abcdef0123456789abcdef";
const BODY = JSON.stringify({ lease: "lea_1", state: "done", score: 100 });
const NOW = 1_800_000_000;

const REPORT: SignedRequest = {
  method: "PUT",
  path: "/api/runner/jobs/sub_1",
  body: BODY,
};

function verify(overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
  return verifySignature({
    secret: SECRET,
    timestamp: String(NOW),
    signature: sign(SECRET, NOW, REPORT),
    request: REPORT,
    now: NOW,
    ...overrides,
  });
}

/** How the protocol signed before the path and the method were covered. */
function legacySign(secret: string, timestamp: number, body: string): string {
  const hex = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${hex}`;
}

describe("sign", () => {
  it("产出 sha256=<hex> 形状", () => {
    expect(sign(SECRET, NOW, REPORT)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("时间戳参与签名", () => {
    expect(sign(SECRET, NOW, REPORT)).not.toBe(
      sign(SECRET, NOW + 1, REPORT),
    );
  });

  it("body 参与签名", () => {
    expect(sign(SECRET, NOW, REPORT)).not.toBe(
      sign(SECRET, NOW, { ...REPORT, body: `${BODY} ` }),
    );
  });

  it("method 参与签名", () => {
    expect(sign(SECRET, NOW, { ...REPORT, method: "POST" })).not.toBe(
      sign(SECRET, NOW, { ...REPORT, method: "PUT" }),
    );
  });

  it("method 不区分大小写，因为 HTTP 本身不区分", () => {
    expect(sign(SECRET, NOW, { ...REPORT, method: "put" })).toBe(
      sign(SECRET, NOW, { ...REPORT, method: "PUT" }),
    );
  });

  /**
   * The reason this change exists. The action a problem invokes travels in the
   * path, so a signature that did not cover it let anything on the wire turn
   * one action into another while the signature still verified.
   */
  it("path 参与签名：同一个 body 换一个动作就换一份签名", () => {
    const body = JSON.stringify({ action: "poll", user: { handle: "alice" } });

    expect(sign(SECRET, NOW, { method: "POST", path: "/action/poll", body })).not.toBe(
      sign(SECRET, NOW, { method: "POST", path: "/action/destroy", body }),
    );
  });

  /**
   * The sharper half of the same problem, and the half that matters most in the
   * direction traffic runs now: fetching a job's contents is an empty-bodied
   * GET, so `<timestamp>.` was once its entire signing input and every
   * empty-bodied request sharing a second shared one signature. One captured
   * pair of headers would then read any submission's payload.
   */
  it("两个空 body 的 GET 不再共用同一份签名", () => {
    const claim = sign(SECRET, NOW, {
      method: "GET",
      path: "/api/runner/jobs/sub_1",
      body: "",
    });
    const other = sign(SECRET, NOW, {
      method: "GET",
      path: "/api/runner/jobs/sub_2",
      body: "",
    });

    expect(claim).not.toBe(other);
  });

  /**
   * Why the canonical string is newline-delimited. A dot appears in both paths
   * and bodies, so with `.` between the fields these two would hash the same
   * string and one signature would be valid for both.
   */
  it("字段分隔不可歧义：path 尾部与 body 头部不能互相挪动", () => {
    expect(sign(SECRET, NOW, { method: "POST", path: "/action/a.b", body: "c" })).not.toBe(
      sign(SECRET, NOW, { method: "POST", path: "/action/a", body: "b.c" }),
    );
  });

  /**
   * The invariant the delimiter rests on, pinned here because it is an
   * assumption about somebody else's parser rather than about this module.
   *
   * A newline in the path *would* be a field boundary — `path: "/a\nx"` with
   * body `y` hashes the same string as `path: "/a"` with body `x\ny`. What
   * rules that out is that every path signed here comes from the WHATWG URL
   * parser, which strips tabs and newlines from its input outright, so no
   * caller can produce one. If that ever stops being true, the canonical
   * string needs a length prefix rather than a delimiter.
   */
  it("path 不可能含换行：URL 解析器会先把它删掉", () => {
    const url = new URL("/action/a\nb?x=1\n2", "http://backend.invalid");

    expect(url.pathname + url.search).not.toContain("\n");
    expect(url.pathname + url.search).toBe("/action/ab?x=12");
  });

  /**
   * Load-bearing rather than tidy: the lease a runner presents on a GET travels
   * in the query string, because there is no body to put it in.
   */
  it("search 参与签名", () => {
    const path = "/api/runner/jobs/sub_1";

    expect(sign(SECRET, NOW, { method: "GET", path, body: "" })).not.toBe(
      sign(SECRET, NOW, { method: "GET", path: `${path}?lease=lea_1`, body: "" }),
    );
  });
});

describe("verifySignature", () => {
  it("接受自己签出来的请求", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("拒绝被篡改的 body", () => {
    expect(
      verify({ request: { ...REPORT, body: JSON.stringify({ score: 0 }) } }),
    ).toMatchObject({ ok: false });
  });

  it("拒绝被改写的 path", () => {
    expect(
      verify({ request: { ...REPORT, path: "/api/runner/jobs/sub_1/../evil" } }),
    ).toMatchObject({ ok: false });
  });

  it("拒绝被改写的 method", () => {
    expect(verify({ request: { ...REPORT, method: "POST" } })).toMatchObject({
      ok: false,
    });
  });

  it("拒绝换了密钥的签名", () => {
    expect(
      verify({ signature: sign("another-secret", NOW, REPORT) }),
    ).toMatchObject({ ok: false });
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

/**
 * There is no compatibility switch: the old form is refused outright. What it
 * gets instead is a reason that names it, because "signature does not match"
 * and "your backend is a version behind" need opposite fixes and an operator
 * staring at a wall of 401s cannot tell them apart.
 */
describe("verifySignature 对旧签名格式", () => {
  it("拒绝只签了 body 的旧格式", () => {
    expect(
      verify({ signature: legacySign(SECRET, NOW, BODY) }),
    ).toMatchObject({ ok: false });
  });

  it("拒绝时明确指出是旧格式，而不是笼统的签名不匹配", () => {
    const result = verify({ signature: legacySign(SECRET, NOW, BODY) });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain("旧格式");
  });

  it("密钥配错时说的仍是签名不匹配，两种原因不混为一谈", () => {
    const result = verify({ signature: sign("wrong-secret", NOW, REPORT) });

    expect(result).toMatchObject({ ok: false, reason: "签名不匹配" });
  });
});

describe("verifySignature 重放窗口", () => {
  function atSkew(seconds: number) {
    const ts = NOW + seconds;
    return verifySignature({
      secret: SECRET,
      timestamp: String(ts),
      signature: sign(SECRET, ts, REPORT),
      request: REPORT,
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
    const headers = signedHeaders(SECRET, REPORT);

    expect(
      verifySignature({
        secret: SECRET,
        timestamp: headers[TIMESTAMP_HEADER],
        signature: headers[SIGNATURE_HEADER],
        request: REPORT,
      }),
    ).toEqual({ ok: true });
  });

  it("换一个 path 校验就不过，说明头确实绑在这个请求上", () => {
    const headers = signedHeaders(SECRET, {
      method: "GET",
      path: "/api/runner/jobs/sub_1",
      body: "",
    });

    expect(
      verifySignature({
        secret: SECRET,
        timestamp: headers[TIMESTAMP_HEADER],
        signature: headers[SIGNATURE_HEADER],
        request: { method: "GET", path: "/api/runner/jobs/sub_2", body: "" },
      }),
    ).toMatchObject({ ok: false });
  });

  it("带上 JSON content-type", () => {
    expect(signedHeaders(SECRET, REPORT)["content-type"]).toBe(
      "application/json",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueToken, verifyToken } from "./stateless";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-that-is-long-enough");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("无状态 token", () => {
  it("签发后按同一用途验证，带回主体、数据与指纹", async () => {
    const token = await issueToken({
      purpose: "email-change",
      subject: "42",
      data: { newEmail: "new@example.test" },
      fingerprint: "fp_abc",
      ttlMs: 60_000,
    });

    expect(await verifyToken(token, "email-change")).toMatchObject({
      p: "email-change",
      s: "42",
      d: { newEmail: "new@example.test" },
      fp: "fp_abc",
    });
  });

  it("用途不同即拒绝", async () => {
    const token = await issueToken({ purpose: "email-verify", subject: "a@b.test", ttlMs: 60_000 });

    expect(await verifyToken(token, "password-reset")).toBeNull();
  });

  it("过期后拒绝", async () => {
    vi.useFakeTimers();
    const token = await issueToken({ purpose: "password-reset", subject: "1", ttlMs: 60_000 });

    vi.advanceTimersByTime(61_000);
    expect(await verifyToken(token, "password-reset")).toBeNull();
  });

  it("换了密钥或改动内容都拒绝", async () => {
    const token = await issueToken({ purpose: "password-reset", subject: "1", ttlMs: 60_000 });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "2", aud: "password-reset", exp: 9e9 })).toString("base64url");

    expect(await verifyToken(`${header}.${forged}.${signature}`, "password-reset")).toBeNull();
    expect(await verifyToken("not-a-token", "password-reset")).toBeNull();

    vi.stubEnv("AUTH_SECRET", "another-secret-that-is-long-enough");
    expect(await verifyToken(token, "password-reset")).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRegistrationProof,
  issueRegistrationProof,
  registrationProofCookieOptions,
  REGISTRATION_PROOF_TTL_MS,
} from "./registration-proof";

const SECRET = "registration-proof-test-secret";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registration proof", () => {
  it("本浏览器刚验证过的邮箱通过", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const proof = issueRegistrationProof("alice@example.test", 1_000_000);
    expect(checkRegistrationProof("alice@example.test", proof, 1_000_000)).toBe(
      true,
    );
  });

  it("换一个邮箱就不通过", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const proof = issueRegistrationProof("alice@example.test", 1_000_000);
    expect(checkRegistrationProof("bob@example.test", proof, 1_000_000)).toBe(
      false,
    );
  });

  it("过期的证明不通过", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const proof = issueRegistrationProof("alice@example.test", 1_000_000);
    expect(
      checkRegistrationProof(
        "alice@example.test",
        proof,
        1_000_000 + REGISTRATION_PROOF_TTL_MS + 1,
      ),
    ).toBe(false);
  });

  it("缺证明、篡改、缺密钥形状一律失败且彼此不可区分", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const proof = issueRegistrationProof("alice@example.test", 1_000_000);

    expect(checkRegistrationProof("alice@example.test", undefined)).toBe(false);
    expect(checkRegistrationProof("alice@example.test", "")).toBe(false);
    expect(checkRegistrationProof("alice@example.test", "not-a-proof")).toBe(
      false,
    );
    expect(
      checkRegistrationProof("alice@example.test", proof.replace(/[0-9a-f]$/, "0")),
    ).toBe(false);
  });

  it("密钥不同则无法伪造", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const proof = issueRegistrationProof("alice@example.test", 1_000_000);
    vi.stubEnv("AUTH_SECRET", "a-different-secret-value");
    expect(checkRegistrationProof("alice@example.test", proof, 1_000_000)).toBe(
      false,
    );
  });
});

/**
 * `Secure` has to follow the scheme this deployment is actually reached over.
 *
 * Keying it on `NODE_ENV` — which the Dockerfile pins to `production` in the
 * one image all three environments run — would mark the cookie `Secure` on the
 * two served over plain HTTP. The browser drops it, the proof never comes back,
 * and every registration on dev and staging fails as `email-unverified` with
 * nothing anywhere saying why. These pin the derivation so that cannot come
 * back by way of a "tidy up the env checks" commit.
 */
describe("registrationProofCookieOptions", () => {
  it("https 部署下带 Secure", () => {
    vi.stubEnv("FOI_PUBLIC_URL", "https://foi.example.com");
    expect(registrationProofCookieOptions().secure).toBe(true);
  });

  it("tailnet 上的 http 部署不带 Secure，否则浏览器根本不存这个 cookie", () => {
    vi.stubEnv("FOI_PUBLIC_URL", "http://tailnet-host:8532");
    expect(registrationProofCookieOptions().secure).toBe(false);
  });

  it("NODE_ENV 不参与判断", () => {
    // The condition this replaced. All three deployed environments run one
    // image with NODE_ENV=production, so it cannot tell them apart.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FOI_PUBLIC_URL", "http://tailnet-host:8633");
    expect(registrationProofCookieOptions().secure).toBe(false);
  });

  it("缺失或不可解析的 FOI_PUBLIC_URL 按非 TLS 处理，而不是抛异常", () => {
    vi.stubEnv("FOI_PUBLIC_URL", "not a url");
    expect(registrationProofCookieOptions().secure).toBe(false);

    vi.stubEnv("FOI_PUBLIC_URL", undefined);
    expect(registrationProofCookieOptions().secure).toBe(false);
  });

  it("始终是 HttpOnly + SameSite=lax", () => {
    vi.stubEnv("FOI_PUBLIC_URL", "https://foi.example.com");
    expect(registrationProofCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});

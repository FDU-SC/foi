import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRegistrationProof,
  issueRegistrationProof,
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

import { describe, expect, it } from "vitest";
import { enrollmentPolicySchema, retiredPolicyKey } from "./types";

/**
 * What a policy file carrying a setting that no longer exists is told.
 *
 * Zod strips unknown keys without complaining, so nothing about parsing would
 * mention it — and for `requireEmailVerification: false` the silence would
 * cover a change to who can register. `lib/enrollment/registry.ts` asks this
 * before parsing so the answer can name the file.
 */
describe("retiredPolicyKey", () => {
  it("认出 requireEmailVerification 并说清该怎么办", () => {
    const complaint = retiredPolicyKey({ requireEmailVerification: false });

    expect(complaint).toContain("requireEmailVerification");
    // The two things a person holding this file needs: that verification is
    // now unconditional, and where the legitimate "no mail" case went.
    expect(complaint).toContain("一律要求验证码");
    expect(complaint).toContain("enabled: false");
  });

  it("设成 true 也报——它已经不是一个选项，不是一个默认值", () => {
    expect(retiredPolicyKey({ requireEmailVerification: true })).not.toBeNull();
  });

  it("正常的策略不报", () => {
    expect(
      retiredPolicyKey({ enabled: true, emailDomains: ["example.test"] }),
    ).toBeNull();
  });

  it("不是对象时不报，交给 schema 去说", () => {
    expect(retiredPolicyKey(undefined)).toBeNull();
    expect(retiredPolicyKey(null)).toBeNull();
    expect(retiredPolicyKey("nonsense")).toBeNull();
  });
});

/**
 * The schema itself no longer knows the key. Pinned because the failure this
 * guards against is silent: `z.object` would strip it and parse happily, so
 * without an assertion nothing distinguishes "removed" from "still honoured".
 */
describe("enrollmentPolicySchema", () => {
  it("解析结果里不再有 requireEmailVerification", () => {
    const parsed = enrollmentPolicySchema.parse({});

    expect(parsed).not.toHaveProperty("requireEmailVerification");
  });

  it("其余默认值没有被这次删除带走", () => {
    expect(enrollmentPolicySchema.parse({})).toMatchObject({
      enabled: true,
      emailDomains: [],
      reservedHandles: [],
      stripSubaddress: true,
      registrationsPerIpPerHour: 10,
    });
  });
});

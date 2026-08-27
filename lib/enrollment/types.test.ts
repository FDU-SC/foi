import { describe, expect, it } from "vitest";
import { enrollmentPolicySchema, retiredPolicyKey } from "./types";

describe("retiredPolicyKey", () => {
  it("认出 requireEmailVerification 并说清该怎么办", () => {
    const complaint = retiredPolicyKey({ requireEmailVerification: false });

    expect(complaint).toContain("requireEmailVerification");

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

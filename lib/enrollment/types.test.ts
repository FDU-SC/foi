import { describe, expect, it } from "vitest";
import { enrollmentPolicySchema } from "./types";

describe("enrollmentPolicySchema", () => {
  it("默认值完整", () => {
    expect(enrollmentPolicySchema.parse({})).toMatchObject({
      enabled: true,
      emailDomains: [],
      stripSubaddress: true,
      registrationsPerIpPerHour: 10,
    });
  });
});

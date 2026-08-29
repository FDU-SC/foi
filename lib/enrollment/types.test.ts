import { describe, expect, it } from "vitest";
import { enrollmentPolicySchema } from "./types";

describe("enrollmentPolicySchema", () => {
  it("默认值完整", () => {
    expect(enrollmentPolicySchema.parse({})).toEqual({
      emailDomains: [],
      stripSubaddress: true,
    });
  });
});

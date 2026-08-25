import { describe, expect, it } from "vitest";
import { verdictSchema } from "./types";

/**
 * A backend may reply with nothing but a status label, so the badge has to
 * stay sensible without a score to grade itself on.
 */
describe("verdictSchema", () => {
  it("只要 status 就是合法的回传", () => {
    expect(verdictSchema.safeParse({ status: "checked" }).success).toBe(true);
  });

  it("status 仍然必填——通用列表总得显示点什么", () => {
    expect(verdictSchema.safeParse({ score: 100 }).success).toBe(false);
  });

  it("maxScore 为零或负数仍然拒绝", () => {
    expect(
      verdictSchema.safeParse({ status: "accepted", maxScore: 0 }).success,
    ).toBe(false);
  });
});
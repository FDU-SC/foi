import { describe, expect, it } from "vitest";
import { verdictSchema } from "./types";

describe("verdictSchema", () => {
  it("只要 result 就是合法的回传", () => {
    expect(verdictSchema.safeParse({ result: { status: "checked" } }).success).toBe(true);
  });

  it("缺少 result 不合法", () => {
    expect(verdictSchema.safeParse({ status: "checked" }).success).toBe(false);
  });

  it("result 加 detail 也合法", () => {
    expect(
      verdictSchema.safeParse({ result: { status: "accepted" }, detail: { tests: [] } }).success,
    ).toBe(true);
  });
});

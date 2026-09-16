import { describe, expect, it } from "vitest";
import { verdictSchema } from "./types";

describe("不透明 JSON 结果", () => {
  it.each([false, 0, "", "text", [null, false, { value: 1 }], { arbitrary: [1] }].map((result) => ({ result })))("接受并保留 $result", ({ result }) => {
    expect(verdictSchema.parse({ result }).result).toEqual(result);
  });
  it("拒绝缺失、顶层 null 和非 JSON 值", () => {
    for (const input of [{}, { result: null }, { result: undefined }, { result: NaN }, { result: () => 1 }, { result: { nested: undefined } }]) {
      expect(verdictSchema.safeParse(input).success).toBe(false);
    }
  });
});

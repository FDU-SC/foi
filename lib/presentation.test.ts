import { describe, expect, it, vi } from "vitest";
import { describeVerdict } from "./presentation";
import { viewsFor } from "./problems/views";
vi.mock("./problems/views", () => ({ viewsFor: vi.fn(() => ({})) }));

describe("内容结果解释", () => {
  it("未提供解释时不读取结果字段", () => {
    expect(describeVerdict(undefined, { status: "secret" })).toEqual({ label: "已评测", short: "已评测", tone: "neutral" });
  });
  it.each([false, 0, "value", [1, 2], { custom: true }].map((result) => ({ result })))("原样传递结果 $result", ({ result }) => {
    const preset = { label: "内容决定", short: "X", tone: "ok" as const };
    const describeResult = vi.fn(() => preset);
    vi.mocked(viewsFor).mockReturnValue({ describeResult });
    expect(describeVerdict("test", result)).toBe(preset);
    expect(describeResult).toHaveBeenCalledWith(result);
  });
});

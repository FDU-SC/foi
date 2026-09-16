import { describe, expect, it } from "vitest";
import type { ProgressSubmission } from "@/lib/problems/views";
import { describeResult, isAcceptedResult, progress } from "./verdicts";

const row = (result: unknown, time = 0, state: ProgressSubmission["state"] = "completed"): ProgressSubmission => ({
  id: String(time), state, result, createdAt: new Date(time), judgedAt: null,
});

describe("示例内容的个人进度", () => {
  it("空历史未尝试，通过优先于后来的失败", () => {
    expect(progress([])).toEqual({ state: "untouched", verdict: null });
    expect(progress([row({ accepted: true }), row({ status: "wrong_answer" }, 1)]).state).toBe("solved");
  });
  it("否则显示最近一次状态，支持原始状态标签", () => {
    expect(progress([row({ status: "wrong_answer" }), row({ status: "custom" }, 1)]).verdict?.label).toBe("custom");
    expect(progress([row(null)] )).toEqual({ state: "attempted", verdict: null });
  });
  it("仅已完成且 boolean accepted 为 true 算通过", () => {
    for (const result of [{ accepted: "true" }, false, 0, [], "accepted", null]) {
      expect(isAcceptedResult(result)).toBe(false);
      expect(progress([row(result)]).state).toBe("attempted");
    }
    expect(progress([row({ accepted: true }, 0, "disrupted")]).state).toBe("attempted");
    expect(progress([row({ accepted: true }, 0, "pending")]).state).toBe("attempted");
  });
  it("未知状态原样展示，其他格式使用中性标签", () => {
    expect(describeResult({ status: "custom" }).label).toBe("custom");
    expect(describeResult({ status: "toString" }).label).toBe("toString");
    expect(describeResult({ status: "__proto__" }).label).toBe("__proto__");
    expect(describeResult(false).tone).toBe("neutral");
  });
});

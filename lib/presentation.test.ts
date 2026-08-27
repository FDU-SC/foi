import { describe, expect, it } from "vitest";
import { describeVerdict } from "./presentation";

describe("describeVerdict 对没有登记的 status", () => {
  it("原样显示 status，未注册的给中性色调", () => {
    expect(
      describeVerdict(undefined, {
        status: "kernel-probe-unnamed",
        score: 40,
        maxScore: 100,
      }),
    ).toMatchObject({ label: "kernel-probe-unnamed", tone: "neutral" });
  });

  it("没有 status 时给一个通用标签", () => {
    expect(describeVerdict(undefined, { score: 100 }).label).toBe("已评测");
  });

  it("result 为 null 时给通用标签", () => {
    expect(describeVerdict(undefined, null).label).toBe("已评测");
  });
});

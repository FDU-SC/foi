import { describe, expect, it } from "vitest";
import { describeVerdict } from "./presentation";

describe("describeVerdict 对没有登记的 status", () => {
  const base = { score: null, maxScore: null, accepted: null };

  it("原样显示，颜色由分数推出来", () => {
    expect(
      describeVerdict(undefined, {
        outcome: "kernel-probe-unnamed",
        score: 40,
        maxScore: 100,
        accepted: null,
      }),
    ).toMatchObject({ label: "kernel-probe-unnamed", tone: "partial" });
  });

  it("满分读成通过", () => {
    expect(
      describeVerdict(undefined, {
        outcome: "kernel-probe-unnamed",
        score: 100,
        maxScore: 100,
        accepted: null,
      }),
    ).toMatchObject({ tone: "ok" });
  });

  it("评测机声明了通过就按通过着色，哪怕分数不满", () => {
    expect(
      describeVerdict(undefined, {
        outcome: "kernel-probe-unnamed",
        score: 40,
        maxScore: 100,
        accepted: true,
      }),
    ).toMatchObject({ tone: "ok" });
  });

  it("没有分数可依据时保持中性，而不是判成错误", () => {
    expect(
      describeVerdict(undefined, { ...base, outcome: "kernel-probe-unnamed" }),
    ).toMatchObject({ label: "kernel-probe-unnamed", tone: "neutral" });
  });

  it("连 status 都没有时给一个通用标签", () => {
    expect(describeVerdict(undefined, { ...base, outcome: null }).label).toBe("已评测");
  });
});

import { describe, expect, it } from "vitest";
import { describeVerdict, verdictSchema } from "./types";

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

describe("describeVerdict", () => {
  const base = { score: null, maxScore: null, accepted: null };

  it("认识的 status 翻译成中文与缩写", () => {
    expect(describeVerdict({ ...base, outcome: "accepted" })).toMatchObject({
      short: "AC",
      tone: "ok",
    });
  });

  it("不认识的 status 原样显示，颜色由分数推出来", () => {
    expect(
      describeVerdict({
        outcome: "slow_but_correct",
        score: 40,
        maxScore: 100,
        accepted: null,
      }),
    ).toMatchObject({ label: "slow_but_correct", tone: "partial" });
  });

  it("评测机声明了通过就按通过着色，哪怕分数不满", () => {
    expect(
      describeVerdict({
        outcome: "slow_but_correct",
        score: 40,
        maxScore: 100,
        accepted: true,
      }),
    ).toMatchObject({ tone: "ok" });
  });

  it("没有分数可依据时保持中性，而不是判成错误", () => {
    expect(describeVerdict({ ...base, outcome: "checked" })).toMatchObject({
      label: "checked",
      tone: "neutral",
    });
  });
});

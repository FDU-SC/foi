import { describe, expect, it } from "vitest";
import {
  floatClose,
  parallelOutputMatches,
  parallelScore,
} from "./mock-runner-hpc";

describe("并行判题的浮点比较", () => {
  it("按参考值的相对误差判断边界", () => {
    expect(floatClose("100.00005", "100", 1e-6)).toBe(true);
    expect(floatClose("100.0002", "100", 1e-6)).toBe(false);
  });

  it("参考值接近零时使用绝对误差", () => {
    expect(floatClose("0.000001", "0", 1e-6)).toBe(true);
    expect(floatClose("0.000002", "0", 1e-6)).toBe(false);
  });

  it("拒绝非数值和无穷值", () => {
    for (const value of ["not-a-number", "Infinity", "NaN", "1 2"]) {
      expect(floatClose(value, "1", 1e-6), value).toBe(false);
    }
  });
});

describe("并行判题的输出比较模式", () => {
  it("默认使用浮点容差比较", () => {
    expect(parallelOutputMatches("3.141593", "3.141592", undefined, 1e-6)).toBe(
      true,
    );
  });

  it("exact 模式忽略首尾空白，但不忽略内容差异", () => {
    expect(parallelOutputMatches(" PASS\n", "PASS", "exact", 0)).toBe(true);
    expect(parallelOutputMatches("PASS", "pass", "exact", 0)).toBe(false);
    expect(parallelOutputMatches("PASS OK", "PASS  OK", "exact", 0)).toBe(
      false,
    );
  });
});

describe("并行判题的评分", () => {
  it("默认按加速比评分，等速得 50 分", () => {
    expect(parallelScore(100, 100, undefined)).toBe(50);
  });

  it("两倍加速得满分且不会溢出", () => {
    expect(parallelScore(100, 100, "speedup")).toBe(50);
    expect(parallelScore(100, 50, "speedup")).toBe(100);
    expect(parallelScore(100, 1, "speedup")).toBe(100);
  });

  it("加速比得分向下取整", () => {
    expect(parallelScore(100, 75, "speedup")).toBe(66);
  });

  it("correctness 模式不受运行耗时影响", () => {
    expect(parallelScore(1, 100_000, "correctness")).toBe(100);
  });
});

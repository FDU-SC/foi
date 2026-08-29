import { describe, expect, it } from "vitest";
import { problemGateWarnings } from "./warnings";

describe("problemGateWarnings", () => {
  it("仓库当前配置不应触发暂存题目与比赛引用打架的告警", () => {
    expect(problemGateWarnings()).toEqual([]);
  });
});

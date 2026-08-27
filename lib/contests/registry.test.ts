import { describe, expect, it } from "vitest";
import { allContests, contestWarnings } from "./registry";

describe("contestWarnings", () => {
  it("仓库里确实有比赛，否则下面那条什么也没验证", () => {
    expect(allContests().length).toBeGreaterThan(0);
  });

  it("仓库当前配置不应触发任何参赛范围告警", () => {
    expect(contestWarnings()).toEqual([]);
  });
});

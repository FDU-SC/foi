import { describe, expect, it } from "vitest";
import { allContests, contestWarnings } from "./registry";

/**
 * The startup warnings, against the real `content/` registries.
 *
 * The same shape `problemGateWarnings` is tested in: a warning nobody can
 * silence is a warning people learn to scroll past, so what is pinned here is
 * that a clean repository stays quiet. The `list` half in particular was
 * unreachable until now — a short-circuit on group enumerability was taking it
 * down with the group check — and the first thing a check that has never run
 * does when it starts running is fire on something legitimate.
 */
describe("contestWarnings", () => {
  it("仓库里确实有比赛，否则下面那条什么也没验证", () => {
    expect(allContests().length).toBeGreaterThan(0);
  });

  it("仓库当前配置不应触发任何参赛范围告警", () => {
    expect(contestWarnings()).toEqual([]);
  });
});

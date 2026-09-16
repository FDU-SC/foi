import { describe, expect, it } from "vitest";
import { ignoresLateSubmissions } from "@/test/standings-support";
import { listRulesets } from "./registry";

/**
 * The contract every ruleset owes the platform: a leaderboard scores
 * `startsAt`..`endsAt` and nothing else, however long the contest keeps
 * collecting. See `ignoresLateSubmissions` for why it cannot be enforced from
 * `compute.ts`.
 */
describe("赛后提交不进排行榜", () => {
  it("注册表里有赛制，否则这条什么也没验证", () => {
    expect(listRulesets().length).toBeGreaterThan(0);
  });

  it.each(listRulesets().map((ruleset) => [ruleset.id, ruleset] as const))(
    "%s 无视窗口之外的那一条",
    (_, ruleset) => {
      const { onTime, withLate } = ignoresLateSubmissions(ruleset);

      expect(
        withLate,
        "赛后提交改变了名次：这个赛制没有把提交过一遍 submissionsInWindow",
      ).toEqual(onTime);
    },
  );
});

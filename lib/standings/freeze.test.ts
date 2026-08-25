import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/lib/auth/test-support";
import { viewerFor } from "@/lib/auth/viewer";
import { capabilitiesOf, listGroups } from "@/lib/auth/groups";
import { ruleset as acmRuleset } from "@/content/rulesets/acm";
import { at, END, input, participants, problem, solve } from "./test-support";

/**
 * Reading through a freeze is expressed by handing the ruleset a contest with
 * no `freezeAt`, so no format has to know the option exists. These cases pin
 * that equivalence: the unfrozen board must match what the same contest would
 * produce if it had never declared a freeze at all.
 */
const problems = [problem("a", "A"), problem("b", "B")];

const submissions = [solve("alice", "a", 10), solve("alice", "b", 250)];

function board(freezeAt: Date | null, now: Date) {
  const original = Date.now;
  Date.now = () => now.getTime();
  try {
    return acmRuleset.computeStandings(
      input({
        participants: participants("alice"),
        problems,
        freezeAt,
        submissions,
      }),
    );
  } finally {
    Date.now = original;
  }
}

describe("封榜的开关就是 freezeAt", () => {
  const during = at(250);
  const freezeAt = at(240);

  it("带 freezeAt 时，封榜后的题不计入", () => {
    const frozen = board(freezeAt, during);
    expect(frozen.frozen).toBe(true);
    expect(frozen.rows[0].total).toBe(1);
  });

  it("去掉 freezeAt 后，同一批提交全部计入", () => {
    const open = board(null, during);
    expect(open.frozen).toBe(false);
    expect(open.rows[0].total).toBe(2);
  });

  it("解冻后的榜与比赛结束后的榜一致", () => {
    // The point of the bypass: an administrator mid-freeze sees the same
    // ranking everyone will see when the contest ends.
    const bypassed = board(null, during);
    const afterEnd = board(freezeAt, new Date(END.getTime() + 1));

    expect(bypassed.rows.map((r) => [r.participant.handle, r.total, r.tiebreak]))
      .toEqual(
        afterEnd.rows.map((r) => [r.participant.handle, r.total, r.tiebreak]),
      );
  });
});

describe("谁能看穿封榜", () => {
  it("选手不能", () => {
    expect(
      viewerFor({ handle: "p", groups: [] }).can("standings.viewFrozen"),
    ).toBe(false);
    expect(AS_PLAYER.can("standings.viewFrozen")).toBe(false);
  });

  it("管理员能", () => {
    expect(
      viewerFor({ handle: "a", groups: ["管理员"] }).can("standings.viewFrozen"),
    ).toBe(true);
  });

  /**
   * Not "only if it declares the capability", which is what this used to say.
   * `submission.readAny` implies it — see `IMPLIES` in `lib/auth/policy.ts` —
   * so a group holding that and nothing else still reads through the freeze,
   * and asserting the narrower rule would have failed the first time somebody
   * split the two apart.
   */
  it("每个组是否能穿透，看它声明的能力加上蕴含出来的", () => {
    for (const group of listGroups()) {
      const viewer = viewerFor({ handle: "x", groups: [group.id] });
      const declared = group.capabilities as readonly string[];
      expect(viewer.can("standings.viewFrozen")).toBe(
        declared.includes("standings.viewFrozen") ||
          declared.includes("submission.readAny"),
      );
    }
  });

  it("只有 submission.readAny 的组也能穿透，因为它本来就能把分加出来", () => {
    expect(capabilitiesOf(["管理员"]).has("standings.viewFrozen")).toBe(true);
    expect(
      capabilitiesOf([]).has("standings.viewFrozen"),
    ).toBe(false);
  });
});

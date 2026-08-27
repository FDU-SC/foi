import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { capabilitiesOf, listGroups } from "@/lib/permissions/groups";
import { viewerFor } from "@/lib/permissions/viewer";
import { groupWith } from "@/test/content-shapes";
import {
  at,
  END,
  input,
  participants,
  problem,
  solve,
  START,
} from "@/test/standings-support";
import { listRulesets } from "./registry";
import type { AnyRuleset, StandingsInput } from "./types";

const allRulesets = listRulesets();

const problems = [problem("a", "A"), problem("b", "B")];
const submissions = [solve(1, "a", 10), solve(1, "b", 250)];

function dualCompute(
  ruleset: AnyRuleset,
  freezeAt: Date | null,
  baseInput: StandingsInput,
) {
  const full = ruleset.compute(baseInput);

  let publicBoard = null;
  if (freezeAt) {
    const preFreezeSubmissions = baseInput.submissions.filter(
      (s) => s.createdAt < freezeAt,
    );
    publicBoard = ruleset.compute({
      ...baseInput,
      submissions: preFreezeSubmissions,
    });
  }

  return { full, public: publicBoard };
}

describe("封榜：任何赛制都支持双次计算", () => {
  it("至少有一种赛制可测", () => {
    expect(allRulesets.length).toBeGreaterThan(0);
  });

  const freezeAt = at(240);

  it.each(allRulesets.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：带 freezeAt 时，public 榜过滤掉了封榜后的提交",
    ({ ruleset }) => {
      const base = input({
        participants: participants(1),
        problems,
        freezeAt,
        submissions,
      });

      const { full, public: pub } = dualCompute(ruleset, freezeAt, base);

      expect(pub).not.toBeNull();
      expect(full.rows[0].total).toBeGreaterThanOrEqual(
        pub!.rows[0].total,
      );
    },
  );

  it.each(allRulesets.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：不带 freezeAt 时没有 public 榜",
    ({ ruleset }) => {
      const base = input({
        participants: participants(1),
        problems,
        submissions,
      });

      const { public: pub } = dualCompute(ruleset, null, base);
      expect(pub).toBeNull();
    },
  );

  it.each(allRulesets.map((r) => ({ ruleset: r, id: r.id })))(
    "$id：全量计算与无封榜计算结果一致",
    ({ ruleset }) => {
      const base = input({
        participants: participants(1),
        problems,
        freezeAt,
        submissions,
      });

      const noFreeze = input({
        participants: participants(1),
        problems,
        submissions,
      });

      const { full } = dualCompute(ruleset, freezeAt, base);
      const plain = ruleset.compute(noFreeze);

      const shape = (b: { rows: { participant: { uid: number }; total: number; tiebreak: number }[] }) =>
        b.rows.map((row) => [row.participant.uid, row.total, row.tiebreak]);

      expect(shape(full)).toEqual(shape(plain));
    },
  );
});

describe("谁能看穿封榜", () => {
  it("选手不能", () => {
    expect(
      viewerFor({ uid: 1, groups: [] }).can("standings.viewFrozen"),
    ).toBe(false);
    expect(AS_PLAYER.can("standings.viewFrozen")).toBe(false);
  });

  it("持有这项能力的组能", () => {
    const group = groupWith("standings.viewFrozen");
    expect(
      viewerFor({ uid: 2, groups: [group] }).can("standings.viewFrozen"),
    ).toBe(true);
  });

  it("每个组是否能穿透，看它声明的能力加上蕴含出来的", () => {
    for (const group of listGroups()) {
      const viewer = viewerFor({ uid: 3, groups: [group.id] });
      const declared = group.capabilities as readonly string[];
      expect(viewer.can("standings.viewFrozen")).toBe(
        declared.includes("standings.viewFrozen") ||
          declared.includes("submission.readAny"),
      );
    }
  });

  it("只有 submission.readAny 的组也能穿透，因为它本来就能把分加出来", () => {
    expect(
      capabilitiesOf([groupWith("submission.readAny")]).has(
        "standings.viewFrozen",
      ),
    ).toBe(true);
    expect(capabilitiesOf([]).has("standings.viewFrozen")).toBe(false);
  });
});

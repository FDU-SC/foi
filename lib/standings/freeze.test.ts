import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { capabilitiesOf, listGroups } from "@/lib/permissions/groups";
import { viewerFor } from "@/lib/permissions/viewer";
import { contestPhase } from "@/lib/contests/types";
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
import type { AnyRuleset } from "./types";

const freezing = listRulesets().filter((ruleset) => ruleset.supportsFreeze);

const problems = [problem("a", "A"), problem("b", "B")];
const submissions = [solve(1, "a", 10), solve(1, "b", 250)];

function board(ruleset: AnyRuleset, freezeAt: Date | null, now: Date) {

  const original = Date.now;
  Date.now = () => now.getTime();
  try {
    return ruleset.computeStandings(
      input({
        participants: participants(1),
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
  it("至少有一种赛制支持封榜，否则这组用例什么也没测", () => {
    expect(freezing.length).toBeGreaterThan(0);
  });

  const during = at(250);
  const freezeAt = at(240);

  it.each(freezing.map((ruleset) => ({ ruleset, id: ruleset.id })))(
    "$id：带 freezeAt 就封，去掉就不封",
    ({ ruleset }) => {
      expect(board(ruleset, freezeAt, during).frozen).toBe(true);
      expect(board(ruleset, null, during).frozen).toBe(false);
    },
  );

  it.each(freezing.map((ruleset) => ({ ruleset, id: ruleset.id })))(
    "$id：解冻后的榜与比赛结束后的榜一致",
    ({ ruleset }) => {

      const bypassed = board(ruleset, null, during);
      const afterEnd = board(ruleset, freezeAt, new Date(END.getTime() + 1));

      const shape = (b: ReturnType<typeof board>) =>
        b.rows.map((row) => [row.participant.uid, row.total, row.tiebreak]);

      expect(shape(bypassed)).toEqual(shape(afterEnd));
    },
  );
});

describe("封榜窗口与比赛相位说的是同一个窗口", () => {
  const freezeAt = at(240);
  const clock = { startsAt: START, endsAt: END, freezeAt };

  const moments = [
    { label: "封榜前一刻", now: new Date(freezeAt.getTime() - 1) },
    { label: "封榜当刻", now: freezeAt },
    { label: "封榜期间", now: at(250) },
    { label: "结束当刻", now: END },
    { label: "结束之后", now: new Date(END.getTime() + 1) },
  ];

  it.each(
    freezing.flatMap((ruleset) =>
      moments.map((moment) => ({ ...moment, ruleset, id: ruleset.id })),
    ),
  )("$id · $label", ({ ruleset, now }) => {
    expect(board(ruleset, freezeAt, now).frozen).toBe(
      contestPhase(clock, now) === "frozen",
    );
  });
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

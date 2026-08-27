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

/**
 * What every format claiming `supportsFreeze` owes the kernel.
 *
 * Reading through a freeze is expressed by handing the ruleset a contest with
 * no `freezeAt`, so no format has to know the option exists. That only works
 * if a format's own comparison agrees with the kernel's — which is why these
 * run over the whole registry rather than over one shipped ruleset. This file
 * used to import `content/rulesets/acm` by name and was the only thing in
 * `lib/` that reached into a specific template; what it was really asserting
 * was true of any freezing format, and now it says so.
 *
 * A format's *scoring* under a freeze is its own business and is pinned beside
 * it, in `content/rulesets/`.
 */
const freezing = listRulesets().filter((ruleset) => ruleset.supportsFreeze);

const problems = [problem("a", "A"), problem("b", "B")];
const submissions = [solve("alice", "a", 10), solve("alice", "b", 250)];

function board(ruleset: AnyRuleset, freezeAt: Date | null, now: Date) {
  // Formats read `Date.now()` to place themselves in the round, which is the
  // one thing these cases have to move.
  const original = Date.now;
  Date.now = () => now.getTime();
  try {
    return ruleset.computeStandings(
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
      // The point of the bypass: an administrator mid-freeze sees the same
      // ranking everyone will see when the contest ends.
      const bypassed = board(ruleset, null, during);
      const afterEnd = board(ruleset, freezeAt, new Date(END.getTime() + 1));

      const shape = (b: ReturnType<typeof board>) =>
        b.rows.map((row) => [row.participant.handle, row.total, row.tiebreak]);

      expect(shape(bypassed)).toEqual(shape(afterEnd));
    },
  );
});

describe("封榜窗口与比赛相位说的是同一个窗口", () => {
  const freezeAt = at(240);
  const clock = { startsAt: START, endsAt: END, freezeAt };

  /**
   * One window, written twice. `contestPhase` is the kernel's copy and
   * documents `[freezeAt, endsAt]` as closed at both ends — `endsAt` belongs
   * to the phase before `ended` so that a contest never walks backwards. A
   * format in `content/` writes the comparison out again, because it computes
   * its own and inherits none of the exhaustive switch that keeps the kernel's
   * phase callers honest.
   *
   * Two copies disagreed at exactly one instant once, the millisecond a round
   * ended: the badge said frozen and the board under it was not. Nothing
   * leaked — the next millisecond unfreezes the board anyway — but the only
   * thing keeping them together is a case that reads them side by side.
   */
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
      viewerFor({ handle: "p", groups: [] }).can("standings.viewFrozen"),
    ).toBe(false);
    expect(AS_PLAYER.can("standings.viewFrozen")).toBe(false);
  });

  it("持有这项能力的组能", () => {
    const group = groupWith("standings.viewFrozen");
    expect(
      viewerFor({ handle: "a", groups: [group] }).can("standings.viewFrozen"),
    ).toBe(true);
  });

  /**
   * Not "only if it declares the capability", which is what this used to say.
   * `submission.readAny` implies it — see `IMPLIES` in `lib/permissions/policy.ts` —
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
    expect(
      capabilitiesOf([groupWith("submission.readAny")]).has(
        "standings.viewFrozen",
      ),
    ).toBe(true);
    expect(capabilitiesOf([]).has("standings.viewFrozen")).toBe(false);
  });
});

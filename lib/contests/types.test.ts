import { describe, expect, it } from "vitest";
import {
  contestPhase,
  contestConfigSchema,
  hasContestEnded,
  hasContestStarted,
  isContestOpen,
  type ContestConfig,
  type ContestPhase,
} from "./types";

/**
 * The clock, on its own.
 *
 * `frozen` used not to be a phase — it was worked out from `freezeAt` wherever
 * somebody needed it — and folding it in broke nothing the compiler could see,
 * because every caller was comparing the phase to a string literal. So what is
 * pinned here is not just where the boundaries fall but that the derived
 * predicates agree with them: those are what the access gates ask, and a
 * predicate that drifts from the phase is the original bug with a new name.
 */

const STARTS = "2026-01-15T13:00:00+08:00";
const FREEZES = "2026-01-15T17:00:00+08:00";
const ENDS = "2026-01-15T18:00:00+08:00";

function contest(overrides: Record<string, unknown> = {}): ContestConfig {
  return contestConfigSchema.parse({
    slug: "test",
    title: "Test",
    ruleset: { id: "some-ruleset" },
    startsAt: STARTS,
    endsAt: ENDS,
    problems: [],
    ...overrides,
  });
}

const at = (iso: string) => new Date(iso);
const nudge = (iso: string, ms: number) => new Date(at(iso).getTime() + ms);

const FROZEN = contest({ freezeAt: FREEZES });
const PLAIN = contest();

describe("contestPhase", () => {
  it("开赛前是 upcoming，开赛当刻就是 running", () => {
    expect(contestPhase(FROZEN, nudge(STARTS, -1))).toBe("upcoming");
    expect(contestPhase(FROZEN, at(STARTS))).toBe("running");
  });

  it("封榜当刻起是 frozen", () => {
    expect(contestPhase(FROZEN, nudge(FREEZES, -1))).toBe("running");
    expect(contestPhase(FROZEN, at(FREEZES))).toBe("frozen");
  });

  it("结束之后是 ended", () => {
    expect(contestPhase(FROZEN, nudge(ENDS, 1))).toBe("ended");
  });

  /**
   * `endsAt` belongs to the contest, which is why a submission made at exactly
   * that instant is still accepted. The freeze window inherits that boundary
   * rather than closing one tick early, so the sequence never runs backwards.
   */
  it("endsAt 当刻仍在比赛内，因此仍是 frozen", () => {
    expect(contestPhase(FROZEN, at(ENDS))).toBe("frozen");
    expect(contestPhase(PLAIN, at(ENDS))).toBe("running");
  });

  it("没有 freezeAt 的比赛任何时刻都不会是 frozen", () => {
    for (const moment of [STARTS, FREEZES, ENDS]) {
      expect(contestPhase(PLAIN, at(moment))).not.toBe("frozen");
    }
  });

  it("相位只向前走，不回退", () => {
    // The property that makes an exhaustive switch over it safe to reason
    // about, and the one an extra `now < endsAt` on the freeze test would
    // break: `frozen` would fall back to `running` for the final instant.
    const order: ContestPhase[] = ["upcoming", "running", "frozen", "ended"];
    const moments = [
      nudge(STARTS, -1),
      at(STARTS),
      nudge(FREEZES, -1),
      at(FREEZES),
      at(ENDS),
      nudge(ENDS, 1),
    ];

    const seen = moments.map((moment) =>
      order.indexOf(contestPhase(FROZEN, moment)),
    );
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });
});

/**
 * The truth table the three gates read, asserted per phase.
 *
 * `isContestOpen` answering `true` for `frozen` is the whole reason these
 * exist: the previous spelling was `phase !== "running"`, which typechecked
 * perfectly and closed submissions for the last hour of every frozen round.
 */
describe("相位派生谓词", () => {
  const moments: { phase: ContestPhase; now: Date }[] = [
    { phase: "upcoming", now: nudge(STARTS, -1) },
    { phase: "running", now: at(STARTS) },
    { phase: "frozen", now: at(FREEZES) },
    { phase: "ended", now: nudge(ENDS, 1) },
  ];

  const expected: Record<
    ContestPhase,
    { open: boolean; started: boolean; ended: boolean }
  > = {
    upcoming: { open: false, started: false, ended: false },
    running: { open: true, started: true, ended: false },
    frozen: { open: true, started: true, ended: false },
    ended: { open: false, started: true, ended: true },
  };

  it("四个相位下三个谓词的答案都是写死的那一套", () => {
    for (const { phase, now } of moments) {
      expect(contestPhase(FROZEN, now)).toBe(phase);
      expect(isContestOpen(FROZEN, now)).toBe(expected[phase].open);
      expect(hasContestStarted(FROZEN, now)).toBe(expected[phase].started);
      expect(hasContestEnded(FROZEN, now)).toBe(expected[phase].ended);
    }
  });

  it("封榜期照常收提交", () => {
    expect(isContestOpen(FROZEN, at(FREEZES))).toBe(true);
    expect(isContestOpen(FROZEN, at(ENDS))).toBe(true);
  });
});

/**
 * Refused at load for the same reason a `freezeAt` against a format that
 * ignores it is refused: the schedule says the board stops updating, and it
 * never does.
 */
describe("freezeAt 的加载期校验", () => {
  function issues(freezeAt: string): string[] {
    const parsed = contestConfigSchema.safeParse({
      slug: "test",
      title: "Test",
      ruleset: { id: "some-ruleset" },
      startsAt: STARTS,
      endsAt: ENDS,
      problems: [],
      freezeAt,
    });
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.path.join("."));
  }

  it("落在区间内的 freezeAt 被接受", () => {
    expect(issues(FREEZES)).toEqual([]);
  });

  it("freezeAt 等于 endsAt 被拒：那是一个空的封榜窗口", () => {
    expect(issues(ENDS)).toEqual(["freezeAt"]);
  });

  it("freezeAt 落在区间外仍然被拒", () => {
    expect(issues("2026-01-15T12:00:00+08:00")).toEqual(["freezeAt"]);
    expect(issues("2026-01-15T19:00:00+08:00")).toEqual(["freezeAt"]);
  });

  it("freezeAt 等于 startsAt 是允许的：全程封榜是一种赛制选择", () => {
    expect(issues(STARTS)).toEqual([]);
  });
});

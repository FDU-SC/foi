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

const STARTS = "2026-01-15T13:00:00+08:00";
const FREEZES = "2026-01-15T17:00:00+08:00";
const ENDS = "2026-01-15T18:00:00+08:00";

function contest(overrides: Record<string, unknown> = {}): ContestConfig {
  return contestConfigSchema.parse({
    slug: "test",
    title: "Test",
    leaderboards: [{ id: "main", title: "排行榜", ruleset: { id: "some-ruleset" } }],
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

describe("freezeAt 的加载期校验", () => {
  function issues(freezeAt: string): string[] {
    const parsed = contestConfigSchema.safeParse({
      slug: "test",
      title: "Test",
      leaderboards: [{ id: "main", title: "排行榜", ruleset: { id: "some-ruleset" } }],
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

describe("题单条目的 label", () => {
  const base = {
    slug: "test",
    title: "Test",
    leaderboards: [{ id: "main", title: "排行榜", ruleset: { id: "some-ruleset" } }],
    startsAt: STARTS,
    endsAt: ENDS,
  };

  it("可以不写 label", () => {
    const parsed = contestConfigSchema.safeParse({
      ...base,
      problems: [{ slug: "one" }, { slug: "two" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("两个相同的 label 被拒", () => {
    const parsed = contestConfigSchema.safeParse({
      ...base,
      problems: [
        { slug: "one", label: "A" },
        { slug: "two", label: "A" },
      ],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "problems.1.label",
    ]);
  });

  it("两道题都没有 label 可以通过", () => {
    const parsed = contestConfigSchema.parse({
      ...base,
      problems: [{ slug: "one" }, { slug: "two" }],
    });
    expect(parsed.problems.map((problem) => problem.label)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

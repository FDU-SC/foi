import { describe, expect, it } from "vitest";
import { input, participants, problem, submission } from "../test-support";
import type { OiCell } from "./oi";
import { oiRuleset } from "./oi";

function compute(options: Parameters<typeof input>[0]) {
  return oiRuleset.computeStandings(input(options));
}

function cell(
  standings: ReturnType<typeof compute>,
  handle: string,
  slug: string,
): OiCell | undefined {
  const row = standings.rows.find((entry) => entry.participant.handle === handle);
  return row?.cells[slug] as OiCell | undefined;
}

const problems = [problem("a", "A"), problem("b", "B")];

function score(handle: string, slug: string, minutes: number, value: number) {
  return submission({
    handle,
    problemSlug: slug,
    minutes,
    score: value,
  });
}

describe("oi 取分策略", () => {
  const attempts = [
    score("alice", "a", 10, 40),
    score("alice", "a", 20, 90),
    score("alice", "a", 30, 60),
  ];

  it("默认取最高分", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: attempts,
    });

    expect(cell(standings, "alice", "a")?.score).toBe(90);
    expect(standings.rows[0].total).toBe(90);
  });

  it("take: last 取最后一次提交的分数", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: { take: "last" },
      submissions: attempts,
    });

    expect(cell(standings, "alice", "a")?.score).toBe(60);
  });

  it("best 在同分时保留首次达到该分的时刻", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [
        score("alice", "a", 10, 80),
        score("alice", "a", 50, 80),
      ],
    });

    expect(cell(standings, "alice", "a")?.at).toBe(10 * 60_000);
  });

  it("每次提交都计入 attempts", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: attempts,
    });

    expect(cell(standings, "alice", "a")?.attempts).toBe(3);
  });
});

describe("oi 总分与用时", () => {
  it("总分是各题得分之和", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [
        score("alice", "a", 10, 70),
        score("alice", "b", 20, 30),
      ],
    });

    expect(standings.rows[0].total).toBe(100);
  });

  it("tiebreak 是最后一次拿到分数的时刻", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [
        score("alice", "a", 10, 70),
        score("alice", "b", 45, 30),
      ],
    });

    expect(standings.rows[0].tiebreak).toBe(45 * 60_000);
  });

  it("零分提交不推进用时", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [
        score("alice", "a", 10, 70),
        score("alice", "b", 90, 0),
      ],
    });

    expect(standings.rows[0].tiebreak).toBe(10 * 60_000);
  });

  it("同分时用时短的排在前", () => {
    const standings = compute({
      participants: participants("alice", "bob"),
      problems,
      submissions: [
        score("alice", "a", 90, 50),
        score("bob", "a", 10, 50),
      ],
    });

    expect(standings.rows.map((row) => row.participant.handle)).toEqual([
      "bob",
      "alice",
    ]);
  });
});

describe("oi 分值上限", () => {
  it("单元格的 maxScore 取比赛的 points 覆盖值", () => {
    const standings = compute({
      participants: participants("alice"),
      problems: [{ ...problem("a", "A", 100), points: 200 }],
      submissions: [score("alice", "a", 10, 150)],
    });

    expect(cell(standings, "alice", "a")?.maxScore).toBe(200);
  });

  it("没有覆盖时回落到题目自身的满分", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [score("alice", "a", 10, 50)],
    });

    expect(cell(standings, "alice", "a")?.maxScore).toBe(100);
  });
});

describe("oi 封榜", () => {
  it("这个赛制不支持封榜", () => {
    expect(
      compute({
        participants: participants("alice"),
        problems,
        submissions: [],
      }).frozen,
    ).toBe(false);
  });
});

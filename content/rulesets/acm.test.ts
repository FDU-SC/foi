import { afterEach, describe, expect, it, vi } from "vitest";
import {
  at,
  END,
  fail,
  input,
  participants,
  problem,
  solve,
  START,
} from "../test-support";
import type { AcmCell } from "./acm";
import { acmRuleset } from "./acm";

/**
 * `computeStandings` reads `Date.now()` to decide whether the board is frozen,
 * so every case here pins the clock. The default is mid-contest.
 */
function compute(
  options: Parameters<typeof input>[0],
  now: Date = at(120),
) {
  vi.setSystemTime(now);
  return acmRuleset.computeStandings(input(options));
}

function cell(
  standings: ReturnType<typeof compute>,
  handle: string,
  slug: string,
): AcmCell | undefined {
  const row = standings.rows.find((entry) => entry.participant.handle === handle);
  return row?.cells[slug] as AcmCell | undefined;
}

afterEach(() => {
  vi.useRealTimers();
});

const problems = [problem("a", "A"), problem("b", "B")];

describe("acm 罚时", () => {
  it("一次通过的罚时就是解题分钟数", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [solve("alice", "a", 42)],
    });

    expect(standings.rows[0].total).toBe(1);
    expect(standings.rows[0].tiebreak).toBe(42);
  });

  it("每次通过前的错误提交加一份罚分", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: { penaltyMinutes: 20 },
      submissions: [
        fail("alice", "a", 10),
        fail("alice", "a", 20),
        solve("alice", "a", 30),
      ],
    });

    // 30 分钟解出 + 2 次错误 × 20 分钟
    expect(standings.rows[0].tiebreak).toBe(70);
  });

  it("penaltyMinutes 可配置，为 0 时只计解题时间", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: { penaltyMinutes: 0 },
      submissions: [fail("alice", "a", 10), solve("alice", "a", 30)],
    });

    expect(standings.rows[0].tiebreak).toBe(30);
  });

  it("未解出的题不产生罚时", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [fail("alice", "a", 10), fail("alice", "a", 20)],
    });

    expect(standings.rows[0].total).toBe(0);
    expect(standings.rows[0].tiebreak).toBe(0);
    expect(cell(standings, "alice", "a")?.attempts).toBe(2);
  });

  it("通过之后的提交完全不影响该题", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [
        solve("alice", "a", 30),
        fail("alice", "a", 40),
        fail("alice", "a", 50),
      ],
    });

    expect(standings.rows[0].tiebreak).toBe(30);
    expect(cell(standings, "alice", "a")?.attempts).toBe(1);
  });

  it("忽略不在参赛名单里的人的提交", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [solve("mallory", "a", 5), solve("alice", "a", 50)],
    });

    expect(standings.rows).toHaveLength(1);
    expect(standings.rows[0].participant.handle).toBe("alice");
    expect(standings.rows[0].tiebreak).toBe(50);
  });
});

describe("acm 封榜", () => {
  const frozenContest = {
    participants: participants("alice"),
    problems,
    freezeAt: at(240),
    submissions: [solve("alice", "a", 10), solve("alice", "b", 250)],
  };

  it("封榜前一切照常", () => {
    const standings = compute(frozenContest, at(239));

    expect(standings.frozen).toBe(false);
    expect(standings.rows[0].total).toBe(2);
  });

  it("封榜后的提交只计 pending，不进总分", () => {
    const standings = compute(frozenContest, at(250));

    expect(standings.frozen).toBe(true);
    expect(standings.rows[0].total).toBe(1);
    expect(cell(standings, "alice", "b")).toMatchObject({
      attempts: 0,
      pending: 1,
      solvedAt: null,
    });
  });

  it("封榜在 freezeAt 当刻即生效", () => {
    expect(compute(frozenContest, at(240)).frozen).toBe(true);
  });

  it("比赛结束后解冻，封榜期的提交被重新计入", () => {
    const standings = compute(frozenContest, new Date(END.getTime() + 1));

    expect(standings.frozen).toBe(false);
    expect(standings.rows[0].total).toBe(2);
    expect(cell(standings, "alice", "b")?.solvedAt).toBe(250);
  });

  it("freezeAt 等于 endsAt 时永远不会封榜", () => {
    const standings = compute(
      { ...frozenContest, freezeAt: END },
      new Date(END.getTime() - 1),
    );

    expect(standings.frozen).toBe(false);
  });

  it("没有 freezeAt 就不会封榜", () => {
    const standings = compute({ ...frozenContest, freezeAt: null }, at(250));

    expect(standings.frozen).toBe(false);
    expect(standings.rows[0].total).toBe(2);
  });
});

describe("acm 排名", () => {
  it("解题多的在前，同解题数比罚时", () => {
    const standings = compute({
      participants: participants("alice", "bob", "carol"),
      problems,
      config: { penaltyMinutes: 20 },
      submissions: [
        // alice：两题，罚时 10 + 60
        solve("alice", "a", 10),
        solve("alice", "b", 60),
        // bob：两题但有一次错误，罚时更高
        fail("bob", "a", 5),
        solve("bob", "a", 10),
        solve("bob", "b", 60),
        // carol：一题
        solve("carol", "a", 1),
      ],
    });

    expect(
      standings.rows.map((row) => [row.participant.handle, row.rank, row.tiebreak]),
    ).toEqual([
      ["alice", 1, 70],
      ["bob", 2, 90],
      ["carol", 3, 1],
    ]);
  });

  it("完全没有提交的参赛者也在榜上，并列末位", () => {
    const standings = compute({
      participants: participants("alice", "bob"),
      problems,
      submissions: [],
    });

    expect(standings.rows.map((row) => row.rank)).toEqual([1, 1]);
  });
});

describe("acm 解题时刻", () => {
  it("solvedAt 以整分钟向下取整", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      submissions: [
        {
          id: "s1",
          handle: "alice",
          problemSlug: "a",
          state: "completed" as const,
          verdict: { status: "accepted", score: 100, maxScore: 100 },
          score: 100,
          createdAt: new Date(START.getTime() + 90_500),
        },
      ],
    });

    expect(cell(standings, "alice", "a")?.solvedAt).toBe(1);
  });
});

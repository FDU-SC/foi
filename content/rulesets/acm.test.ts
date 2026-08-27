import { describe, expect, it } from "vitest";
import {
  fail,
  input,
  participants,
  problem,
  solve,
  START,
  unjudged,
} from "@/test/standings-support";
import type { AcmCell } from "./acm";
import { ruleset as acmRuleset } from "./acm";

function compute(
  options: Parameters<typeof input>[0],
) {
  return acmRuleset.compute(input(options));
}

function cell(
  standings: ReturnType<typeof compute>,
  uid: number,
  slug: string,
): AcmCell | undefined {
  const row = standings.rows.find((entry) => entry.participant.uid === uid);
  return row?.cells[slug] as AcmCell | undefined;
}

const problems = [problem("a", "A"), problem("b", "B")];

describe("acm 罚时", () => {
  it("一次通过的罚时就是解题分钟数", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [solve(1, "a", 42)],
    });

    expect(standings.rows[0].total).toBe(1);
    expect(standings.rows[0].tiebreak).toBe(42);
  });

  it("每次通过前的错误提交加一份罚分", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      config: { penaltyMinutes: 20 },
      submissions: [
        fail(1, "a", 10),
        fail(1, "a", 20),
        solve(1, "a", 30),
      ],
    });

    expect(standings.rows[0].tiebreak).toBe(70);
  });

  it("penaltyMinutes 可配置，为 0 时只计解题时间", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      config: { penaltyMinutes: 0 },
      submissions: [fail(1, "a", 10), solve(1, "a", 30)],
    });

    expect(standings.rows[0].tiebreak).toBe(30);
  });

  it("未解出的题不产生罚时", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [fail(1, "a", 10), fail(1, "a", 20)],
    });

    expect(standings.rows[0].total).toBe(0);
    expect(standings.rows[0].tiebreak).toBe(0);
    expect(cell(standings, 1, "a")?.attempts).toBe(2);
  });

  it("通过之后的提交完全不影响该题", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [
        solve(1, "a", 30),
        fail(1, "a", 40),
        fail(1, "a", 50),
      ],
    });

    expect(standings.rows[0].tiebreak).toBe(30);
    expect(cell(standings, 1, "a")?.attempts).toBe(1);
  });

  it("忽略不在参赛名单里的人的提交", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [solve(99, "a", 5), solve(1, "a", 50)],
    });

    expect(standings.rows).toHaveLength(1);
    expect(standings.rows[0].participant.uid).toBe(1);
    expect(standings.rows[0].tiebreak).toBe(50);
  });
});

describe("acm 未判完的提交", () => {
  it("排队中的提交记 pending，不记 attempts，也不影响总分", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [unjudged(1, "a", 30)],
    });

    expect(standings.rows[0].total).toBe(0);
    expect(standings.rows[0].tiebreak).toBe(0);
    expect(cell(standings, 1, "a")).toMatchObject({
      attempts: 0,
      pending: 1,
      solvedAt: null,
    });
  });

  it("评测中的提交与排队中的一样", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [unjudged(1, "a", 30, "pending")],
    });

    expect(cell(standings, 1, "a")?.pending).toBe(1);
  });

  it("判完之后 pending 变成 attempts，罚时才开始算", () => {
    const queued = compute({
      participants: participants(1),
      problems,
      submissions: [fail(1, "a", 10), unjudged(1, "a", 30)],
    });
    expect(cell(queued, 1, "a")).toMatchObject({ attempts: 1, pending: 1 });

    const judged = compute({
      participants: participants(1),
      problems,
      submissions: [fail(1, "a", 10), solve(1, "a", 30)],
    });
    expect(cell(judged, 1, "a")).toMatchObject({ attempts: 2, pending: 0 });
    expect(judged.rows[0].tiebreak).toBe(50);
  });

  it("disrupted 既不记 pending 也不记 attempts", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [unjudged(1, "a", 30, "disrupted")],
    });

    expect(cell(standings, 1, "a")).toBeUndefined();
  });

  it("已经解出的题不再收 pending", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [solve(1, "a", 30), unjudged(1, "a", 40)],
    });

    expect(cell(standings, 1, "a")).toMatchObject({
      attempts: 1,
      pending: 0,
      solvedAt: 30,
    });
  });
});

describe("acm 排名", () => {
  it("解题多的在前，同解题数比罚时", () => {
    const standings = compute({
      participants: participants(1, 2, 3),
      problems,
      config: { penaltyMinutes: 20 },
      submissions: [

        solve(1, "a", 10),
        solve(1, "b", 60),

        fail(2, "a", 5),
        solve(2, "a", 10),
        solve(2, "b", 60),

        solve(3, "a", 1),
      ],
    });

    expect(
      standings.rows.map((row) => [row.participant.uid, row.rank, row.tiebreak]),
    ).toEqual([
      [1, 1, 70],
      [2, 2, 90],
      [3, 3, 1],
    ]);
  });

  it("完全没有提交的参赛者也在榜上，并列末位", () => {
    const standings = compute({
      participants: participants(1, 2),
      problems,
      submissions: [],
    });

    expect(standings.rows.map((row) => row.rank)).toEqual([1, 1]);
  });
});

describe("acm 解题时刻", () => {
  it("solvedAt 以整分钟向下取整", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [
        {
          id: "s1",
          uid: 1,
          problemSlug: "a",
          state: "completed" as const,
          result: { status: "accepted", score: 100, maxScore: 100, accepted: true },
          createdAt: new Date(START.getTime() + 90_500),
        },
      ],
    });

    expect(cell(standings, 1, "a")?.solvedAt).toBe(1);
  });
});

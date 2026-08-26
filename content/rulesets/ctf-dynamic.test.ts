import { describe, expect, it } from "vitest";
import { fail, input, participants, problem, solve } from "@/test/standings-support";
import type { CtfCell } from "./ctf-dynamic";
import { ruleset as ctfDynamicRuleset } from "./ctf-dynamic";

function compute(options: Parameters<typeof input>[0]) {
  return ctfDynamicRuleset.computeStandings(input(options));
}

function cell(
  standings: ReturnType<typeof compute>,
  handle: string,
  slug: string,
): CtfCell | undefined {
  const row = standings.rows.find((entry) => entry.participant.handle === handle);
  return row?.cells[slug] as CtfCell | undefined;
}

const problems = [problem("a", "A"), problem("b", "B")];

/** No blood bonus, so a cell's score is the题目 value on its own. */
const plain = { bloodBonus: [] as number[] };

describe("ctf 动态分值衰减", () => {
  it("只有一个人解出时是满值", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: plain,
      submissions: [solve("alice", "a", 10)],
    });

    expect(cell(standings, "alice", "a")?.score).toBe(500);
  });

  it("解出的人越多，题目越不值钱", () => {
    const values = [1, 2, 3, 5, 10].map((count) => {
      const handles = Array.from({ length: count }, (_, i) => `u${i}`);
      const standings = compute({
        participants: participants(...handles),
        problems,
        config: plain,
        submissions: handles.map((handle, i) => solve(handle, "a", 10 + i)),
      });
      return cell(standings, "u0", "a")?.score ?? 0;
    });

    // 严格单调递减
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThan(values[i - 1]);
    }
    expect(values[0]).toBe(500);
  });

  it("衰减不会跌破 minimum", () => {
    const handles = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const standings = compute({
      participants: participants(...handles),
      problems,
      config: { ...plain, minimum: 100 },
      submissions: handles.map((handle, i) => solve(handle, "a", 10 + i)),
    });

    expect(cell(standings, "u0", "a")?.score).toBe(100);
  });

  it("initial / minimum / decay 可配置", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: { ...plain, initial: 1000 },
      submissions: [solve("alice", "a", 10)],
    });

    expect(cell(standings, "alice", "a")?.score).toBe(1000);
  });
});

describe("ctf 血奖", () => {
  it("前三名解出者按顺序拿到加成", () => {
    const handles = ["alice", "bob", "carol", "dave"];
    const standings = compute({
      participants: participants(...handles),
      problems,
      config: { bloodBonus: [0.1, 0.05, 0.02] },
      submissions: handles.map((handle, i) => solve(handle, "a", 10 + i)),
    });

    const value = cell(standings, "dave", "a")?.score ?? 0;
    expect(cell(standings, "alice", "a")?.score).toBeCloseTo(value * 1.1, 6);
    expect(cell(standings, "bob", "a")?.score).toBeCloseTo(value * 1.05, 6);
    expect(cell(standings, "carol", "a")?.score).toBeCloseTo(value * 1.02, 6);
  });

  it("血次按解出先后而非提交先后", () => {
    const standings = compute({
      participants: participants("alice", "bob"),
      problems,
      config: { bloodBonus: [0.1, 0.05] },
      submissions: [
        // alice 先提交但没解出，bob 后提交却先解出，一血归 bob
        fail("alice", "a", 5),
        solve("bob", "a", 10),
        solve("alice", "a", 20),
      ],
    });

    expect(cell(standings, "bob", "a")?.blood).toBe(1);
    expect(cell(standings, "alice", "a")?.blood).toBe(2);
  });

  it("超出 bloodBonus 长度的名次没有血标记", () => {
    const handles = ["alice", "bob"];
    const standings = compute({
      participants: participants(...handles),
      problems,
      config: { bloodBonus: [0.1] },
      submissions: handles.map((handle, i) => solve(handle, "a", 10 + i)),
    });

    expect(cell(standings, "alice", "a")?.blood).toBe(1);
    expect(cell(standings, "bob", "a")?.blood).toBeNull();
  });
});

describe("ctf 失败尝试", () => {
  it("未解出的题也留下 attempts", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: plain,
      submissions: [fail("alice", "a", 10), fail("alice", "a", 20)],
    });

    expect(cell(standings, "alice", "a")).toMatchObject({
      score: 0,
      solvedAt: null,
      attempts: 2,
    });
    expect(standings.rows[0].total).toBe(0);
  });

  it("解出后的提交不再累加 attempts", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: plain,
      submissions: [
        fail("alice", "a", 10),
        solve("alice", "a", 20),
        fail("alice", "a", 30),
      ],
    });

    expect(cell(standings, "alice", "a")?.attempts).toBe(2);
  });
});

describe("ctf 参赛名单", () => {
  /**
   * The roster is not a fixed thing: a `mode: "group"` contest resolves it on
   * every read, so somebody dropping out of a group is enough to put solves
   * from a non-participant into the input. Counting them changes the answer
   * for everybody, because the solve count is the divisor.
   */
  it("非参赛者的 AC 不改变分值衰减", () => {
    const alone = compute({
      participants: participants("alice"),
      problems,
      config: plain,
      submissions: [solve("alice", "a", 10)],
    });
    const withOutsider = compute({
      participants: participants("alice"),
      problems,
      config: plain,
      submissions: [solve("alice", "a", 10), solve("mallory", "a", 20)],
    });

    expect(cell(alone, "alice", "a")?.score).toBe(500);
    expect(cell(withOutsider, "alice", "a")?.score).toBe(
      cell(alone, "alice", "a")?.score,
    );
  });

  /**
   * Skipping the award was never the same as not counting the solve: the
   * outsider still held the earliest position, so first blood went to nobody
   * instead of to the first competitor.
   */
  it("非参赛者不占血", () => {
    const standings = compute({
      participants: participants("alice", "bob"),
      problems,
      config: { bloodBonus: [0.1, 0.05] },
      submissions: [
        solve("mallory", "a", 5),
        solve("alice", "a", 10),
        solve("bob", "a", 20),
      ],
    });

    expect(cell(standings, "alice", "a")?.blood).toBe(1);
    expect(cell(standings, "bob", "a")?.blood).toBe(2);
  });
});

describe("ctf 总分与排名", () => {
  it("总分是各题得分之和，tiebreak 是末次解题时刻", () => {
    const standings = compute({
      participants: participants("alice"),
      problems,
      config: plain,
      submissions: [solve("alice", "a", 10), solve("alice", "b", 30)],
    });

    expect(standings.rows[0].total).toBe(1000);
    expect(standings.rows[0].tiebreak).toBe(30 * 60_000);
  });

  it("解出更多题的人排在前面", () => {
    const standings = compute({
      participants: participants("alice", "bob"),
      problems,
      config: plain,
      submissions: [
        solve("alice", "a", 10),
        solve("bob", "a", 20),
        solve("bob", "b", 30),
      ],
    });

    expect(standings.rows[0].participant.handle).toBe("bob");
  });

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

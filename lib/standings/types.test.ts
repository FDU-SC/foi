import { describe, expect, it } from "vitest";
import {
  at,
  END,
  input,
  participants,
  problem,
  submission,
  unjudged,
} from "@/test/standings-support";
import {
  assignRanks,
  isAccepted,
  scoredSubmissions,
  submissionsInWindow,
} from "./types";

describe("assignRanks", () => {
  function ranked(rows: { total: number; tiebreak: number }[]) {
    return assignRanks(
      rows.map((row, index) => ({
        participant: { uid: index, nickname: `u${index}` },
        total: row.total,
        tiebreak: row.tiebreak,
        cells: {},
      })),
    ).map((row) => ({ uid: row.participant.uid, rank: row.rank }));
  }

  it("按 total 降序、tiebreak 升序排列", () => {
    expect(
      ranked([
        { total: 1, tiebreak: 10 },
        { total: 3, tiebreak: 99 },
        { total: 3, tiebreak: 20 },
      ]),
    ).toEqual([
      { uid: 2, rank: 1 },
      { uid: 1, rank: 2 },
      { uid: 0, rank: 3 },
    ]);
  });

  it("两键都相同的行共享名次，并让后续名次跳号", () => {
    expect(
      ranked([
        { total: 5, tiebreak: 0 },
        { total: 3, tiebreak: 7 },
        { total: 3, tiebreak: 7 },
        { total: 1, tiebreak: 0 },
      ]).map((row) => row.rank),
    ).toEqual([1, 2, 2, 4]);
  });

  it("tiebreak 不同就不算并列", () => {
    expect(
      ranked([
        { total: 3, tiebreak: 7 },
        { total: 3, tiebreak: 8 },
      ]).map((row) => row.rank),
    ).toEqual([1, 2]);
  });

  it("空输入返回空数组", () => {
    expect(ranked([])).toEqual([]);
  });
});

describe("scoredSubmissions", () => {
  const base = {
    participants: participants(1),
    problems: [problem("a", "A")],
  };

  it("只保留 completed 的提交", () => {
    const rows = scoredSubmissions(
      input({
        ...base,
        submissions: [
          submission({ uid: 1, problemSlug: "a", minutes: 5, score: 100 }),
          submission({
            uid: 1,
            problemSlug: "a",
            minutes: 6,
            score: 0,
            state: "pending",
          }),
          submission({
            uid: 1,
            problemSlug: "a",
            minutes: 7,
            score: 0,
            state: "disrupted",
          }),
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(at(5));
  });

  it("剔除比赛窗口之外的提交", () => {
    const rows = scoredSubmissions(
      input({
        ...base,
        submissions: [
          submission({ uid: 1, problemSlug: "a", minutes: -1, score: 100 }),
          submission({ uid: 1, problemSlug: "a", minutes: 10, score: 100 }),
          submission({ uid: 1, problemSlug: "a", minutes: 999, score: 100 }),
        ],
      }),
    );

    expect(rows.map((row) => row.createdAt)).toEqual([at(10)]);
  });

  it("窗口边界含两端", () => {
    const rows = scoredSubmissions(
      input({
        ...base,
        submissions: [
          submission({ uid: 1, problemSlug: "a", minutes: 0, score: 100 }),
          submission({ uid: 1, problemSlug: "a", minutes: 300, score: 100 }),
        ],
        endsAt: END,
      }),
    );

    expect(rows).toHaveLength(2);
  });

  it("按时间升序返回，与输入顺序无关", () => {
    const rows = scoredSubmissions(
      input({
        ...base,
        submissions: [
          submission({ uid: 1, problemSlug: "a", minutes: 30, score: 0 }),
          submission({ uid: 1, problemSlug: "a", minutes: 10, score: 0 }),
          submission({ uid: 1, problemSlug: "a", minutes: 20, score: 0 }),
        ],
      }),
    );

    expect(rows.map((row) => row.createdAt)).toEqual([at(10), at(20), at(30)]);
  });
});

describe("submissionsInWindow", () => {
  const base = {
    participants: participants(1),
    problems: [problem("a", "A")],
  };

  it("保留还没判完的提交", () => {
    const rows = submissionsInWindow(
      input({
        ...base,
        submissions: [
          submission({ uid: 1, problemSlug: "a", minutes: 5, score: 100 }),
          unjudged(1, "a", 6),
          unjudged(1, "a", 7, "pending"),
        ],
      }),
    );

    expect(rows.map((row) => row.state)).toEqual([
      "completed",
      "pending",
      "pending",
    ]);
  });

  it("剔除 disrupted", () => {
    const rows = submissionsInWindow(
      input({
        ...base,
        submissions: [unjudged(1, "a", 5, "disrupted")],
      }),
    );

    expect(rows).toEqual([]);
  });

  it("窗口与排序和 scoredSubmissions 一致", () => {
    const built = input({
      ...base,
      submissions: [
          submission({ uid: 1, problemSlug: "a", minutes: -1, score: 100 }),
          submission({ uid: 1, problemSlug: "a", minutes: 30, score: 0 }),
          submission({ uid: 1, problemSlug: "a", minutes: 10, score: 0 }),
          submission({ uid: 1, problemSlug: "a", minutes: 999, score: 100 }),
      ],
      endsAt: END,
    });

    expect(submissionsInWindow(built).map((row) => row.createdAt)).toEqual([
      at(10),
      at(30),
    ]);
    expect(submissionsInWindow(built)).toEqual(scoredSubmissions(built));
  });
});

describe("isAccepted", () => {
  const record = (score: number, maxScore: number) =>
    submission({
      uid: 1,
      problemSlug: "a",
      minutes: 1,
      score,
      maxScore,
    });

  it("满分算通过", () => {
    expect(isAccepted(record(100, 100))).toBe(true);
  });

  it("部分分不算通过", () => {
    expect(isAccepted(record(99, 100))).toBe(false);
  });

  it("超过满分也算通过", () => {
    expect(isAccepted(record(120, 100))).toBe(true);
  });

  it("还没判完不算通过", () => {
    expect(
      isAccepted(
        submission({
          uid: 1,
          problemSlug: "a",
          minutes: 1,
          score: 100,
          state: "pending",
        }),
      ),
    ).toBe(false);
  });

  it("评测机说了算：声明不通过时，满分也不算通过", () => {
    expect(
      isAccepted(
        submission({
          uid: 1,
          problemSlug: "a",
          minutes: 1,
          score: 100,
          accepted: false,
        }),
      ),
    ).toBe(false);
  });

  it("评测机说了算：声明通过时，零分也算通过", () => {
    expect(
      isAccepted(
        submission({
          uid: 1,
          problemSlug: "a",
          minutes: 1,
          score: 0,
          accepted: true,
        }),
      ),
    ).toBe(true);
  });

  it("评测机什么分都没报时不算通过", () => {
    expect(
      isAccepted({
        id: "s_noscore",
        uid: 1,
        problemSlug: "a",
        state: "completed",
        verdict: { status: "checked" },
        score: null,
        maxScore: null,
        accepted: null,
        createdAt: at(1),
      }),
    ).toBe(false);
  });
});

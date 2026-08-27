import { describe, expect, it } from "vitest";
import { allProblems } from "@/lib/problems/registry";
import { verdictColumns } from "./verdict";

const someProblem = allProblems()[0]!;

describe("verdictColumns", () => {
  it("回传了 maxScore 就用回传的", () => {
    const columns = verdictColumns(
      { status: "accepted", score: 42, maxScore: 60 },
      someProblem.maxScore,
    );

    expect(columns.score).toBe(42);
    expect(columns.maxScore).toBe(60);
  });

  it("没回传 maxScore 就落到调用方给的兜底分母", () => {
    const columns = verdictColumns(
      { status: "accepted", score: 1 },
      someProblem.maxScore,
    );

    expect(columns.maxScore).toBe(someProblem.maxScore);
  });

  it("调用方也给不出分母时留空，而不是编一个出来", () => {

    const columns = verdictColumns({ status: "accepted", score: 1 }, null);

    expect(columns.maxScore).toBeNull();
  });

  it("什么都没回传时只留下 status", () => {
    const columns = verdictColumns({ status: "checked" }, someProblem.maxScore);

    expect(columns.score).toBeNull();
    expect(columns.accepted).toBeNull();
    expect(columns.outcome).toBe("checked");
  });

  it("accepted 只记评测机声明过的，沉默是 null 而不是 false", () => {
    expect(
      verdictColumns({ status: "wrong_answer", score: 0 }, someProblem.maxScore)
        .accepted,
    ).toBeNull();
    expect(
      verdictColumns(
        { status: "slow_but_correct", score: 40, accepted: true },
        someProblem.maxScore,
      ).accepted,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { allProblems } from "@/lib/problems/registry";
import { verdictColumns } from "./verdict";

/**
 * The boundary where a backend's reply stops being a message and becomes the
 * kernel's own data. Everything downstream reads the columns, so a mistake
 * here is invisible until a scoreboard disagrees with a submission page.
 */
const someProblem = allProblems()[0]!;

describe("verdictColumns", () => {
  it("回传了 maxScore 就用回传的", () => {
    const columns = verdictColumns(
      { status: "accepted", score: 42, maxScore: 60 },
      someProblem.slug,
    );

    expect(columns.score).toBe(42);
    expect(columns.maxScore).toBe(60);
  });

  it("没回传 maxScore 就落到题目配置的满分", () => {
    const columns = verdictColumns(
      { status: "accepted", score: 1 },
      someProblem.slug,
    );

    expect(columns.maxScore).toBe(someProblem.maxScore);
  });

  it("题目已从仓库删除时 maxScore 为空，而不是编一个出来", () => {
    // Reachable through the reconciler: a submission outlives the problem it
    // was made against. A wrong denominator would silently rescore it.
    const columns = verdictColumns({ status: "accepted", score: 1 }, "gone");

    expect(columns.maxScore).toBeNull();
  });

  it("什么都没回传时只留下 status", () => {
    const columns = verdictColumns({ status: "checked" }, someProblem.slug);

    expect(columns.score).toBeNull();
    expect(columns.accepted).toBeNull();
    expect(columns.outcome).toBe("checked");
  });

  it("accepted 只记评测机声明过的，沉默是 null 而不是 false", () => {
    expect(
      verdictColumns({ status: "wrong_answer", score: 0 }, someProblem.slug)
        .accepted,
    ).toBeNull();
    expect(
      verdictColumns(
        { status: "slow_but_correct", score: 40, accepted: true },
        someProblem.slug,
      ).accepted,
    ).toBe(true);
  });
});

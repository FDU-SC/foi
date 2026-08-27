import { describe, expect, it } from "vitest";
import {
  contestWithGroupEntry,
  externalProblem,
  groupWith,
  inlineProblem,
  publicProblemOutside,
  reservedHandle,
  retiredProblem,
} from "./content-shapes";

describe("挂载的 content 能撑起内核用例", () => {
  it("有一场按 group 限制参赛、且第一道题覆盖了 rateLimit 的比赛", () => {
    const { contest, entry, group } = contestWithGroupEntry();
    expect(entry.rateLimit).toBeDefined();
    expect(group).toBeTruthy();

    expect(
      publicProblemOutside(contest, new Date(contest.startsAt.getTime() + 1)),
    ).toBeDefined();
  });

  it("有一道 retired 的题目", () => {
    expect(retiredProblem().retired).toBe(true);
  });

  it("有一道在役的、由后端评测的题目", () => {
    expect(externalProblem().backend.id).toBeTruthy();
  });

  it("有一道内联判题的题目", () => {
    expect(inlineProblem().slug).toBeTruthy();
  });

  it("有带能力的组", () => {
    expect(groupWith("problem.viewAll")).toBeTruthy();
    expect(groupWith("admin.access")).toBeTruthy();
  });

  it("至少保留了一个用户名", () => {
    expect(reservedHandle()).toBeTruthy();
  });
});

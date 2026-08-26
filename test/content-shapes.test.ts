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

/**
 * That whatever `content/` is mounted can hold the kernel's suites up.
 *
 * Every finder throws a sentence naming the shape it wanted, so this file's
 * job is only to call them: a deployment missing one gets a single failure
 * that says which mechanism is going untested, instead of a dozen failures
 * scattered across `lib/` that look like the kernel broke.
 *
 * It is the reason the shapes are worth writing down at all. The kernel's
 * tests run against the live registries on purpose — a fixture registry would
 * agree with a gate that had drifted — and the price of that is a contract
 * with `content/`. This is the contract, stated in one place and checked
 * before anything depends on it.
 */
describe("挂载的 content 能撑起内核用例", () => {
  it("有一场按 group 限制参赛、且第一道题覆盖了 rateLimit 的比赛", () => {
    const { contest, entry, group } = contestWithGroupEntry();
    expect(entry.rateLimit).toBeDefined();
    expect(group).toBeTruthy();
    // And something outside it, which is what separates "this round does not
    // contain that problem" from "you are not in this round".
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

import { describe, expect, it } from "vitest";
import { allProblems } from "./registry";
import { viewsFor } from "./views";

describe("viewsFor 对没有登记渲染的题目", () => {
  const ABSENT = "kernel-probe-no-such-problem";

  it("给一个空的插槽集合，而不是抛错", () => {
    expect(viewsFor(ABSENT)).toEqual({});
  });

  it("两个插槽都是 undefined，调用方因此走各自的回落", () => {
    const views = viewsFor(ABSENT);
    expect(views.PayloadView).toBeUndefined();
    expect(views.VerdictDetail).toBeUndefined();
  });

  it("探针用的 slug 确实没有被这套 content 占用", () => {

    expect(allProblems().some((problem) => problem.slug === ABSENT)).toBe(false);
  });
});

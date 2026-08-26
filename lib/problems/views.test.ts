import { describe, expect, it } from "vitest";
import { allProblems } from "./registry";
import { viewsFor } from "./views";

/**
 * The fallback half of `viewsFor`: what a problem that claims no rendering
 * gets, and what a submission whose problem is gone gets.
 *
 * Probed with a slug no deployment would ship rather than by finding a problem
 * that happens not to declare `views.tsx`. The two are the same branch —
 * `registry.get` does not distinguish a problem with no views from a problem
 * that is not there — and the probe holds against any `content/`, including
 * one where every problem fills both slots. Wanting a real problem to leave
 * the slot empty would have made a rendering choice in `content/` load-bearing
 * for a kernel test, which is the arrangement `test/content-shapes.ts` exists
 * to keep narrow.
 *
 * That an *unfilled* slot renders as JSON is `components/opaque/`'s business;
 * this only pins what those components are handed.
 */
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
    // Otherwise the two cases above would be asserting something about a real
    // problem's rendering.
    expect(allProblems().some((problem) => problem.slug === ABSENT)).toBe(false);
  });
});

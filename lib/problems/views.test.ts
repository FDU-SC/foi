import { describe, expect, it } from "vitest";
import { viewsFor } from "./views";

describe("viewsFor 对没有登记渲染的题目", () => {
  const ABSENT = "kernel-probe-no-such-problem";

  it("给一个空的插槽集合，而不是抛错", () => {
    expect(viewsFor(ABSENT)).toEqual({});
  });
});

/**
 * A problem that ships in the repository has a module to render it. One authored
 * in the console has none — it names a preset, and the name travels with the
 * problem because the browser resolves views too and has no snapshot of the
 * database to look one up in.
 */
describe("viewsFor 对只报了 preset 的题目", () => {
  const ABSENT = "kernel-probe-no-such-problem";

  it("按 preset 取渲染", () => {
    const views = viewsFor(ABSENT, "fixture-plain");
    expect(views.describeResult?.(7)).toMatchObject({ label: "preset:7" });
  });

  it("没有解释器的 preset 就是空的，而不是退回落默认", () => {
    const views = viewsFor(ABSENT, "fixture-bare");
    expect(views.describeResult).toBeUndefined();
  });

  it("部署不再提供的 preset 退回默认", () => {
    const views = viewsFor(ABSENT, "no-such-preset");
    expect(views.describeResult?.(7)).toMatchObject({ label: "preset:7" });
  });

  it("题目自己登记的渲染优先于 preset，仓库里的题目因此不受影响", () => {
    // fixture-external 自己的 views.tsx 声明了 facets；preset 不该盖掉它。
    expect(viewsFor("fixture-external", "fixture-bare").facets).toBeDefined();
    expect(viewsFor("fixture-external", "fixture-bare").describeResult).toBeDefined();
  });
});

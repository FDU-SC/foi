import { describe, expect, it } from "vitest";
import { viewsFor } from "./views";

describe("viewsFor 对没有登记渲染的题目", () => {
  const ABSENT = "kernel-probe-no-such-problem";

  it("给一个空的插槽集合，而不是抛错", () => {
    expect(viewsFor(ABSENT)).toEqual({});
  });
});

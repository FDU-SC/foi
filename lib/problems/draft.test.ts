import { describe, expect, it } from "vitest";
import { caseArgv } from "./draft";

/**
 * One test point's arguments, read from the form's single text field.
 *
 * The two notations exist because two things are natural: typing a short list,
 * and pasting the `argv: [...]` line out of a `problem.ts`. Reading the second
 * as the first used to produce a set of arguments that were all strings and all
 * wrong, which the judge would then act on.
 */
describe("测试点的 argv", () => {
  it("空格分隔是表单自己的写法", () => {
    expect(caseArgv("2049 0.22 10")).toEqual(["2049", "0.22", "10"]);
    expect(caseArgv("  a   b  ")).toEqual(["a", "b"]);
  });

  it("粘进来的 JSON 数组也认", () => {
    expect(caseArgv('["2049", "0.22", "10", "0.7", "${JOB_ID_SHA16}"]')).toEqual([
      "2049",
      "0.22",
      "10",
      "0.7",
      "${JOB_ID_SHA16}",
    ]);
  });

  it("JSON 里带空格的单个参数不会被切开", () => {
    expect(caseArgv('["a b", "c"]')).toEqual(["a b", "c"]);
  });

  it("空着就是没有参数", () => {
    expect(caseArgv("")).toEqual([]);
    expect(caseArgv("   ")).toEqual([]);
  });

  it("不是字符串数组的 JSON 退回空格分隔，而不是当成参数表", () => {
    expect(caseArgv("[1, 2]")).toEqual(["[1,", "2]"]);
    expect(caseArgv('[{"a":1}]')).toEqual(['[{"a":1}]']);
  });

  it("以 [ 开头但不是合法 JSON 时也退回空格分隔", () => {
    expect(caseArgv("[abc def")).toEqual(["[abc", "def"]);
  });

  it("被上一版表单切碎的数组，在下一轮保存时自己拼回来", () => {
    // 表单把 JSON 数组按空格切成了这些碎片；编辑区把它们用单空格接回去，
    // 于是再存一次就还原成原来的数组，不需要重新粘一遍。
    const shredded = ['["2049",', '"0.22",', '"10",', '"0.7",', '"${JOB_ID_SHA16}"]'];

    expect(caseArgv(shredded.join(" "))).toEqual([
      "2049",
      "0.22",
      "10",
      "0.7",
      "${JOB_ID_SHA16}",
    ]);
  });
});

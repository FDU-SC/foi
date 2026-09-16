import { describe, expect, it } from "vitest";
import { describeAudience, inAudience } from "./audience";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerWith } from "@/test/content-shapes";
import { viewerFor } from "./viewer";

const player = viewerFor({ uid: 1, groups: ["2026级", "本科生"] });

describe("inAudience", () => {
  it("省略 visibleTo 表示所有人", () => {
    expect(inAudience(undefined, player)).toBe(true);
    expect(inAudience(undefined, AS_PLAYER)).toBe(true);
  });

  it("空数组表示无人——这是「暂存」的写法", () => {
    expect(inAudience([], player)).toBe(false);
    expect(inAudience([], AS_PLAYER)).toBe(false);
  });

  it("命中任意一个列出的组即可", () => {
    expect(inAudience(["校队", "2026级"], player)).toBe(true);
  });

  it("一个都不沾就看不到", () => {
    expect(inAudience(["校队"], player)).toBe(false);
  });

  it("组名精确匹配，不做前缀", () => {
    expect(inAudience(["2026"], player)).toBe(false);
  });

  it("匿名视角只能看到面向所有人的资源", () => {
    expect(inAudience(["本科生"], AS_PLAYER)).toBe(false);
  });

  it("能力不参与这个判断——越权是调用方另外问的", () => {

    const admin = viewerWith("problem.read", 100);
    expect(inAudience(["校队"], admin)).toBe(false);
  });
});

describe("describeAudience", () => {
  it("三种状态各有说法", () => {
    expect(describeAudience(undefined)).toBe("所有人");
    expect(describeAudience([])).toBe("无人（暂存）");
    expect(describeAudience(["校队", "教练"])).toBe("校队、教练");
  });
});


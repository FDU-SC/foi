import { describe, expect, it } from "vitest";
import { audienceCovers, describeAudience, inAudience } from "./audience";
import { AS_PLAYER } from "./test-support";
import { viewerWith } from "@/test/content-shapes";
import { viewerFor } from "./viewer";

const player = viewerFor({ handle: "alice", groups: ["2026级", "本科生"] });

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
    // `inAudience` answers "is this for you". Whether somebody may look past
    // that answer is a separate question, asked with `viewer.can(...)`, so
    // that the two axes stay legible where they are combined.
    const admin = viewerWith("problem.viewAll", "root");
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

describe("audienceCovers", () => {
  it("所有人覆盖任何受众", () => {
    expect(audienceCovers(undefined, undefined)).toBe(true);
    expect(audienceCovers(undefined, ["校队"])).toBe(true);
    expect(audienceCovers(undefined, [])).toBe(true);
  });

  it("只有「所有人」能覆盖「所有人」", () => {
    expect(audienceCovers(["校队"], undefined)).toBe(false);
    expect(audienceCovers([], undefined)).toBe(false);
  });

  it("超集覆盖子集", () => {
    expect(audienceCovers(["校队", "教练"], ["校队"])).toBe(true);
    expect(audienceCovers(["校队"], ["校队"])).toBe(true);
  });

  it("缺一个组就不覆盖", () => {
    expect(audienceCovers(["校队"], ["校队", "教练"])).toBe(false);
    expect(audienceCovers(["校队"], ["教练"])).toBe(false);
  });

  it("空受众只覆盖空受众", () => {
    expect(audienceCovers([], [])).toBe(true);
    expect(audienceCovers([], ["校队"])).toBe(false);
  });
});

describe("比赛受众不得超出题目受众", () => {
  it("这正是「公开比赛塞一道校队题」被拒的判据", () => {
    // The leak it prevents: the contest page would print that problem's title
    // and link for somebody the problem itself answers 404 to.
    const contestForEveryone = undefined;
    const problemForTeam = ["校队"];
    expect(audienceCovers(problemForTeam, contestForEveryone)).toBe(false);
  });

  it("反过来是允许的：一场校队赛可以用一道公开题", () => {
    expect(audienceCovers(undefined, ["校队"])).toBe(true);
  });
});

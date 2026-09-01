import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { allows } from "@/lib/authz/engine";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { viewerWith } from "@/test/content-shapes";
import { contestFor } from "@/lib/contests/access";
import { contestsUsing, embargoOf } from "@/lib/contests/by-problem";
import { allContests } from "@/lib/contests/registry";
import { hasContestStarted } from "@/lib/contests/types";
import { allProblems } from "./registry";
import {
  problemFor,
  problemStatus,
  problemsFor,
  recentProblemsFor,
} from "./access";

const contests = allContests();
const demo = contests[0];

const PREVIEW = viewerWith("problem.read", 100);

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

function after(date: Date): Date {
  return new Date(date.getTime() + 60_000);
}

describe("题目→比赛反向索引", () => {
  it("每场比赛的每道题都能反查到这场比赛", () => {
    for (const contest of contests) {
      for (const entry of contest.problems) {
        expect(contestsUsing(entry.slug).map((c) => c.slug)).toContain(
          contest.slug,
        );
      }
    }
  });

  it("不存在的 slug 反查为空而不是抛错", () => {
    expect(contestsUsing("no-such-problem")).toEqual([]);
  });
});

describe("禁运", () => {
  it("被未开赛的比赛引用时扣住，开赛当刻即放开", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;

    expect(embargoOf(slug, before(demo.startsAt))).toEqual({
      contestSlug: demo.slug,
      opensAt: demo.startsAt,
    });
    expect(embargoOf(slug, demo.startsAt)).toBeNull();
    expect(embargoOf(slug, after(demo.endsAt))).toBeNull();
  });

  it("不属于任何比赛的题目从不被扣住", () => {
    for (const problem of allProblems()) {
      if (contestsUsing(problem.slug).length > 0) continue;
      expect(embargoOf(problem.slug, new Date())).toBeNull();
    }
  });
});

describe("problemFor", () => {
  it("禁运期内对选手返回 undefined", () => {
    if (!demo) return;
    expect(
      problemFor(demo.problems[0].slug, AS_PLAYER, before(demo.startsAt)),
    ).toBeUndefined();
  });

  it("禁运期内对预览者返回题目，并标出它还没公开", () => {
    if (!demo) return;

    const view = problemFor(
      demo.problems[0].slug,
      PREVIEW,
      before(demo.startsAt),
    );

    expect(view?.config.slug).toBe(demo.problems[0].slug);
    expect(view?.preview).toBe(true);
    expect(view?.embargo).toEqual({
      contestSlug: demo.slug,
      opensAt: demo.startsAt,
    });
  });

  it("开赛后对选手返回题目，且不算预览", () => {
    if (!demo) return;

    const view = problemFor(demo.problems[0].slug, AS_PLAYER, demo.startsAt);
    expect(view?.preview).toBe(false);
    expect(view?.embargo).toBeNull();
  });

  it("不存在的 slug 返回 undefined，与被扣住的返回值无法区分", () => {
    expect(problemFor("no-such-problem", AS_PLAYER)).toBeUndefined();
    expect(problemFor("no-such-problem", PREVIEW)).toBeUndefined();
  });
});

describe("problemsFor", () => {
  it("选手视角下没有一道是预览", () => {
    for (const view of problemsFor(AS_PLAYER)) {
      expect(view.preview).toBe(false);
    }
  });

  it("预览视角会带上还没公开的题目", () => {
    const plain = problemsFor(AS_PLAYER);
    const withPreview = problemsFor(PREVIEW);

    expect(withPreview.length).toBeGreaterThanOrEqual(plain.length);
  });

  it("结果随时刻变化：未开始的比赛开赛后其题目进入列表", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;

    expect(
      problemsFor(AS_PLAYER, before(demo.startsAt)).map((e) => e.config.slug),
    ).not.toContain(slug);
    expect(
      problemsFor(AS_PLAYER, demo.startsAt).map((e) => e.config.slug),
    ).toContain(slug);
  });

  it("列出的恰好是对本人开放、未被扣住、且未下架的那些", () => {
    const visible = new Set(
      problemsFor(AS_PLAYER).map((entry) => entry.config.slug),
    );

    for (const problem of allProblems()) {
      const openToAll = problem.visibleTo === undefined;
      const expected =
        openToAll && embargoOf(problem.slug, new Date()) === null && !problem.retired;

      expect(visible.has(problem.slug), problem.slug).toBe(expected);
    }
  });
});

describe("recentProblemsFor", () => {
  // Past every contest window, so nothing here is measuring an embargo.
  const AT = new Date("2100-01-01");

  const VIEWERS: [string, Viewer][] = [
    ["选手", AS_PLAYER],
    ["预览者", PREVIEW],
  ];

  it("先按上架日期倒序，没声明日期的排在最后", () => {
    const listed = recentProblemsFor(PREVIEW, Infinity, AT).map(
      (view) => view.config,
    );

    const dated = listed.filter((config) => config.addedAt);
    const undated = listed.filter((config) => !config.addedAt);

    expect(dated.length).toBeGreaterThan(1);
    expect(undated.length).toBeGreaterThan(0);
    expect(listed, "没声明日期的题插到了有日期的之间").toEqual([
      ...dated,
      ...undated,
    ]);

    const times = dated.map((config) => config.addedAt!.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("没声明日期的题之间保持目录序", () => {
    const catalogue = problemsFor(PREVIEW, AT).map((view) => view.config.slug);
    const undated = recentProblemsFor(PREVIEW, Infinity, AT)
      .filter((view) => !view.config.addedAt)
      .map((view) => view.config.slug);

    expect(undated).toEqual(catalogue.filter((slug) => undated.includes(slug)));
  });

  it.each(VIEWERS)(
    "%s 看到的仍是 problemsFor 那一批，只是换了个顺序",
    (_, viewer) => {
      const catalogue = problemsFor(viewer, AT).map((view) => view.config.slug);
      const recent = recentProblemsFor(viewer, Infinity, AT).map(
        (view) => view.config.slug,
      );

      expect(
        [...recent].sort(),
        "重排不该放进受众挡下的、被扣住的或已下架的题",
      ).toEqual([...catalogue].sort());
    },
  );

  it("排出来的顺序不等于目录序，否则等于没排", () => {
    const catalogue = problemsFor(PREVIEW, AT).map((view) => view.config.slug);
    const recent = recentProblemsFor(PREVIEW, Infinity, AT).map(
      (view) => view.config.slug,
    );

    expect(recent).not.toEqual(catalogue);
  });

  it("limit 截的是重排之后的队首", () => {
    const all = recentProblemsFor(PREVIEW, Infinity, AT);
    expect(all.length).toBeGreaterThan(1);
    expect(recentProblemsFor(PREVIEW, 1, AT)).toEqual(all.slice(0, 1));
  });
});

describe("下架与可见性正交", () => {
  const retired = allProblems().filter((problem) => problem.retired);

  it("仓库里有下架的示例题，否则下面几条什么也没验证", () => {
    expect(retired.length).toBeGreaterThan(0);
  });

  it("下架的题题面仍然可读，但交不了也动不了", () => {
    for (const problem of retired) {
      expect(problemFor(problem.slug, AS_PLAYER)).toBeDefined();
      expect(allows("problem.submit", problem, PREVIEW)).toBe(false);
      expect(allows("problem.invoke", problem, PREVIEW)).toBe(false);
    }
  });

  it("谁的列表里都没有下架的题，包括能预览的人", () => {
    for (const viewer of [AS_PLAYER, PREVIEW]) {
      const listed = new Set(
        problemsFor(viewer).map((entry) => entry.config.slug),
      );
      for (const problem of retired) {
        expect(listed.has(problem.slug)).toBe(false);
      }
    }
  });
});

describe("能看到比赛与能看到题目的关系", () => {
  const VIEWERS: Viewer[] = [
    AS_PLAYER,
    viewerFor({ uid: 6, groups: ["一个普通分组"] }),
    PREVIEW,
  ];

  it("已开赛：拿得到比赛的人，拿得到它的每一道题", () => {
    expect(contests.length).toBeGreaterThan(0);

    for (const contest of contests) {
      for (const now of [contest.startsAt, after(contest.endsAt)]) {
        expect(hasContestStarted(contest, now)).toBe(true);

        for (const viewer of VIEWERS) {
          if (!contestFor(contest.slug, viewer, now)) continue;

          for (const entry of contest.problems) {
            expect(
              problemFor(entry.slug, viewer, now),
              `${viewer.uid} 拿得到 ${contest.slug}，却拿不到它的 ${entry.slug}`,
            ).toBeDefined();
          }
        }
      }
    }
  });

  it("未开赛：受众内、没有额外授权的选手，读不到只属于这场比赛的题", () => {
    for (const contest of contests) {
      const at = before(contest.startsAt);
      const insider = viewerFor({ uid: 9, groups: contest.visibleTo ?? [] });

      if (contest.visibleTo?.length === 0) continue;
      expect(contestFor(contest.slug, insider, at)).toBeDefined();

      for (const entry of contest.problems) {
        if (contestsUsing(entry.slug).length !== 1) continue;

        expect(
          problemFor(entry.slug, insider, at),
          `${contest.slug} 还没开赛，但受众内的普通选手读到了 ${entry.slug}`,
        ).toBeUndefined();
      }
    }
  });
});

describe("受众", () => {
  const outsider = viewerFor({ uid: 11, groups: ["无能力的组-乙"] });
  const inTeam = viewerFor({ uid: 10, groups: ["无能力的组-甲"] });

  const gated = allProblems().find((problem) => problem.visibleTo?.length);

  it.skipIf(!gated)("受众不通过就是不通过，与时刻无关", () => {
    const audience = gated!.visibleTo ?? [];
    const excluded = viewerFor({ uid: 12, groups: [] });
    const member = viewerFor({ uid: 13, groups: [...audience] });

    for (const now of [new Date("2000-01-01"), new Date("2100-01-01")]) {
      expect(problemFor(gated!.slug, excluded, now)).toBeUndefined();
    }

    expect(problemFor(gated!.slug, member, new Date("2100-01-01"))).toBeDefined();
  });

  it("仓库里的题目默认面向所有人", () => {
    for (const problem of allProblems()) {
      if (problem.visibleTo !== undefined) continue;
      expect(Boolean(problemFor(problem.slug, outsider))).toBe(
        Boolean(problemFor(problem.slug, inTeam)),
      );
    }
  });
});

describe("problemStatus", () => {
  it("在册且未下架的题目是 live，标题来自注册表而不是快照", () => {
    const live = allProblems().find((problem) => !problem.retired)!;
    expect(problemStatus(live.slug, "陈旧的快照")).toEqual({
      kind: "live",
      title: live.title,
    });
  });

  it("下架的题目是 retired，标题照样来自注册表", () => {
    const retired = allProblems().find((problem) => problem.retired);
    if (!retired) return;
    expect(problemStatus(retired.slug, "陈旧的快照")).toEqual({
      kind: "retired",
      title: retired.title,
    });
  });

  it("注册表里没有的题目是 gone，只剩镜像行里的快照可用", () => {
    expect(problemStatus("__deleted-long-ago", "当年的标题")).toEqual({
      kind: "gone",
      title: "当年的标题",
    });
  });
});

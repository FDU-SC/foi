import { describe, expect, it } from "vitest";
import { capabilitiesOf, listGroups } from "@/lib/permissions/groups";
import { CAPABILITIES } from "@/lib/permissions/policy";
import { AS_PLAYER } from "@/test/auth-support";
import { viewerFor, type Viewer } from "@/lib/permissions/viewer";
import { viewerWith } from "@/test/content-shapes";
import { contestFor } from "@/lib/contests/access";
import { allContests } from "@/lib/contests/registry";
import { hasContestStarted, type ContestConfig } from "@/lib/contests/types";
import { allProblems } from "./registry";
import {
  contestsUsing,
  problemFor,
  problemGateWarnings,
  problemStatus,
  problemVisibility,
  problemsFor,
} from "./access";

const contests = allContests();

const demo = contests[0];

const PREVIEW = viewerWith("problem.viewAll", 100);

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

function after(date: Date): Date {
  return new Date(date.getTime() + 60_000);
}

describe("viewerFor", () => {
  it("匿名与选手都拿不到预览", () => {
    expect(viewerFor(null).can("problem.viewAll")).toBe(false);
    expect(viewerFor({ uid: 1, groups: [] }).can("problem.viewAll")).toBe(
      false,
    );
  });

  it("持有该能力的组拿得到预览", () => {
    expect(viewerWith("problem.viewAll").can("problem.viewAll")).toBe(
      true,
    );
  });

  it("AS_PLAYER 对任何能力都答否", () => {
    for (const capability of CAPABILITIES) {
      expect(AS_PLAYER.can(capability)).toBe(false);
    }
  });

  it("viewer 的答案与 capabilitiesOf 逐项一致，没有第二份定义", () => {

    for (const group of listGroups()) {
      const viewer = viewerFor({ uid: 2, groups: [group.id] });
      const granted = capabilitiesOf([group.id]);
      for (const capability of CAPABILITIES) {
        expect(viewer.can(capability)).toBe(granted.has(capability));
      }
    }
  });

  it("多个组的能力取并集", () => {
    const declared = listGroups().filter((g) => g.capabilities.length > 0);
    if (declared.length === 0) return;

    const viewer = viewerFor({
      uid: 3,
      groups: [...declared.map((g) => g.id), "一个不存在的组"],
    });
    for (const group of declared) {
      for (const capability of group.capabilities) {
        expect(viewer.can(capability)).toBe(true);
      }
    }
  });

  it("未声明的组不带任何能力", () => {
    const viewer = viewerFor({ uid: 4, groups: ["未声明的组-甲", "未声明的组-乙"] });
    for (const capability of CAPABILITIES) {
      expect(viewer.can(capability)).toBe(false);
    }
  });
});

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

describe("problemVisibility", () => {
  it("比赛开始前，题目被封禁到开赛时刻", () => {
    if (!demo) return;

    expect(
      problemVisibility(demo.problems[0].slug, AS_PLAYER, before(demo.startsAt)),
    ).toEqual({
      visible: false,
      reason: "embargo",
      contestSlug: demo.slug,
      opensAt: demo.startsAt,
    });
  });

  it("开赛当刻即放开，不需要重新部署", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;

    expect(problemVisibility(slug, AS_PLAYER, before(demo.startsAt)).visible).toBe(false);
    expect(problemVisibility(slug, AS_PLAYER, demo.startsAt).visible).toBe(true);
  });

  it("比赛结束后依然可见", () => {
    if (!demo) return;
    expect(
      problemVisibility(demo.problems[0].slug, AS_PLAYER, after(demo.endsAt)).visible,
    ).toBe(true);
  });

  const staged = allProblems().find(
    (problem) =>
      problem.visibleTo?.length === 0 && contestsUsing(problem.slug).length === 0,
  );

  it.skipIf(!staged)("visibleTo 为空且不属于任何比赛的题目，按受众被拒", () => {
    expect(problemVisibility(staged!.slug, AS_PLAYER)).toEqual({
      visible: false,
      reason: "audience",
      audience: [],
    });
  });

  it("不存在的 slug 被拒，而不是默认可见", () => {
    expect(problemVisibility("no-such-problem", PREVIEW).visible).toBe(false);
    expect(problemVisibility("no-such-problem", AS_PLAYER).visible).toBe(false);
  });
});

describe("problemsFor", () => {
  it("选手视角下不含任何被封禁的题目", () => {
    for (const { gate } of problemsFor(AS_PLAYER)) {
      expect(gate.visible).toBe(true);
    }
  });

  it("预览视角会带上被封禁的题目，并标出原因", () => {
    const plain = problemsFor(AS_PLAYER);
    const withPreview = problemsFor(PREVIEW);

    expect(withPreview.length).toBeGreaterThanOrEqual(plain.length);
    for (const entry of withPreview) {
      if (!entry.gate.visible) {
        expect(["audience", "embargo"]).toContain(entry.gate.reason);
      }
    }
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

  it("没有任何参数能让选手视角看到被封禁的题目", () => {

    const player = problemsFor(viewerFor({ uid: 5, groups: [] }));
    expect(player.every((entry) => entry.gate.visible)).toBe(true);
  });
});

describe("problemFor", () => {
  it("被封禁时对选手返回 undefined", () => {
    if (!demo) return;

    expect(
      problemFor(demo.problems[0].slug, AS_PLAYER, before(demo.startsAt)),
    ).toBeUndefined();
  });

  it("被封禁时对预览者返回题目，并附上原因", () => {
    if (!demo) return;

    const view = problemFor(
      demo.problems[0].slug,
      PREVIEW,
      before(demo.startsAt),
    );

    expect(view?.config.slug).toBe(demo.problems[0].slug);
    expect(view?.gate.visible).toBe(false);
  });

  it("开赛后对选手返回题目", () => {
    if (!demo) return;

    const view = problemFor(demo.problems[0].slug, AS_PLAYER, demo.startsAt);
    expect(view?.gate.visible).toBe(true);
  });

  it("不存在的 slug 返回 undefined，与被封禁的返回值无法区分", () => {
    expect(problemFor("no-such-problem", AS_PLAYER)).toBeUndefined();
    expect(problemFor("no-such-problem", PREVIEW)).toBeUndefined();
  });

  it("与 problemsFor 对同一道题的判断一致", () => {
    for (const { config, gate } of problemsFor(PREVIEW)) {
      const single = problemFor(config.slug, PREVIEW);
      expect(single?.gate).toEqual(gate);
    }
  });
});

describe("problemGateWarnings", () => {
  it("仓库当前配置不应触发 hidden 与比赛引用打架的告警", () => {
    expect(problemGateWarnings()).toEqual([]);
  });
});

describe("题库列表与门禁一致", () => {
  it("列出的题目，恰好是对本人开放、未被未开始的比赛封禁、且未下架的那些", () => {
    const visible = new Set(
      problemsFor(AS_PLAYER).map((entry) => entry.config.slug),
    );

    for (const problem of allProblems()) {
      const embargoed = contestsUsing(problem.slug).some(
        (contest) => !hasContestStarted(contest),
      );
      const released = contestsUsing(problem.slug).some((contest) =>
        hasContestStarted(contest),
      );
      const openToAll = problem.visibleTo === undefined;
      const expected =
        openToAll && (released || !embargoed) && !problem.retired;

      expect(visible.has(problem.slug)).toBe(expected);
    }
  });
});

describe("能看到比赛与能看到题目的关系", () => {

  const VIEWERS: Viewer[] = [
    AS_PLAYER,
    viewerFor({ uid: 6, groups: ["一个普通分组"] }),
    PREVIEW,
    { uid: 7, groups: [], can: (c) => c === "contest.viewAll" },
    {
      uid: 8,
      groups: [],
      can: (c) => c === "contest.viewAll" || c === "problem.viewAll",
    },
  ];

  function insiderOf(contest: ContestConfig): Viewer {
    return {
      uid: 9,
      groups: contest.visibleTo ?? [],
      can: () => false,
    };
  }

  it("已开赛：拿得到比赛的人，拿得到它的每一道题", () => {
    expect(contests.length).toBeGreaterThan(0);

    for (const contest of contests) {
      for (const now of [contest.startsAt, after(contest.endsAt)]) {
        expect(hasContestStarted(contest, now)).toBe(true);

        for (const viewer of VIEWERS) {
          if (!contestFor(contest.slug, viewer)) continue;

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

  it("未开赛：受众内、无任何能力的选手，读不到只属于这场比赛的题", () => {
    for (const contest of contests) {
      const at = before(contest.startsAt);
      const insider = insiderOf(contest);

      if (contest.visibleTo?.length === 0) continue;
      expect(contestFor(contest.slug, insider)).toBeDefined();

      for (const entry of contest.problems) {

        if (contestsUsing(entry.slug).length !== 1) continue;

        expect(
          problemFor(entry.slug, insider, at),
          `${contest.slug} 还没开赛，但受众内的普通选手读到了 ${entry.slug}`,
        ).toBeUndefined();
      }
    }
  });

  it("经由比赛读到的题不进题库列表，也交不了", () => {

    for (const viewer of VIEWERS) {
      if (viewer.can("problem.viewAll")) continue;
      for (const entry of problemsFor(viewer)) {
        expect(entry.gate.visible).toBe(true);
        expect(entry.open).toBe(true);
        expect(entry.reachedVia).toBeNull();
      }
    }
  });
});

describe("下架与可见性正交", () => {
  const retired = allProblems().filter((problem) => problem.retired);

  it("仓库里有下架的示例题，否则下面几条什么也没验证", () => {
    expect(retired.length).toBeGreaterThan(0);
  });

  it("下架的题仍然可见，但不可提交", () => {
    for (const problem of retired) {
      const view = problemFor(problem.slug, AS_PLAYER);

      expect(view).toBeDefined();
      expect(view?.gate.visible).toBe(problem.visibleTo === undefined);
      expect(view?.open).toBe(false);
    }
  });

  it("下架的题不出现在题库列表里", () => {
    const listed = new Set(
      problemsFor(AS_PLAYER).map((entry) => entry.config.slug),
    );
    for (const problem of retired) {
      expect(listed.has(problem.slug)).toBe(false);
    }
  });

  it("problem.viewAll 能在列表里看到它们，并且照样标着不可提交", () => {
    const listed = new Map(
      problemsFor(PREVIEW).map((entry) => [entry.config.slug, entry]),
    );
    for (const problem of retired) {
      expect(listed.get(problem.slug)?.open).toBe(false);
    }
  });

  it("没下架的题目里，open 与 gate.visible 一致", () => {

    for (const problem of allProblems()) {
      if (problem.retired) continue;
      const view = problemFor(problem.slug, PREVIEW);
      expect(view?.open).toBe(view?.gate.visible);
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

describe("受众与阶段的组合", () => {

  const inTeam = viewerFor({ uid: 10, groups: ["无能力的组-甲"] });
  const outsider = viewerFor({ uid: 11, groups: ["无能力的组-乙"] });

  const gated = allProblems().find((problem) => problem.visibleTo?.length);

  const contested =
    gated && contestsUsing(gated.slug).length > 0 ? gated : undefined;

  it.skipIf(!gated)("受众不通过就是不通过，与时刻无关", () => {
    const audience = gated!.visibleTo ?? [];
    const excluded = viewerFor({ uid: 12, groups: [] });
    const member = viewerFor({ uid: 13, groups: [...audience] });

    for (const now of [new Date("2000-01-01"), new Date("2100-01-01")]) {
      expect(problemVisibility(gated!.slug, excluded, now)).toEqual({
        visible: false,
        reason: "audience",
        audience,
      });
    }

    expect(
      problemVisibility(gated!.slug, member, new Date("2100-01-01")).visible,
    ).toBe(true);
  });

  it.skipIf(!contested)("受众先于阶段：禁运期内的理由仍是 audience", () => {
    const excluded = viewerFor({ uid: 14, groups: [] });
    const opensAt = contestsUsing(contested!.slug)
      .map((contest) => contest.startsAt)
      .reduce((earliest, at) => (at < earliest ? at : earliest));

    expect(problemVisibility(contested!.slug, excluded, before(opensAt))).toEqual(
      {
        visible: false,
        reason: "audience",
        audience: contested!.visibleTo ?? [],
      },
    );
  });

  it("受众通过时，由阶段决定看不看得到", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;

    for (const viewer of [outsider, inTeam]) {
      expect(problemVisibility(slug, viewer, before(demo.startsAt))).toEqual({
        visible: false,
        reason: "embargo",
        contestSlug: demo.slug,
        opensAt: demo.startsAt,
      });
      expect(problemVisibility(slug, viewer, demo.startsAt).visible).toBe(true);
    }
  });

  it("problem.viewAll 越过两个轴，门禁却照样说明理由", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;
    const now = before(demo.startsAt);

    expect(problemVisibility(slug, PREVIEW, now).visible).toBe(false);
    expect(problemFor(slug, PREVIEW, now)?.reachedVia).toBe("problem.viewAll");
    expect(problemFor(slug, outsider, now)).toBeUndefined();
  });

  it("仓库里的题目默认面向所有人", () => {
    for (const problem of allProblems()) {
      if (problem.visibleTo !== undefined) continue;
      expect(problemVisibility(problem.slug, outsider).visible).toBe(
        problemVisibility(problem.slug, inTeam).visible,
      );
    }
  });
});

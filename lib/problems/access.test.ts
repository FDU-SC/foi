import { describe, expect, it } from "vitest";
import { capabilitiesOf, listGroups } from "@/lib/auth/groups";
import { CAPABILITIES } from "@/lib/auth/policy";
import { AS_PLAYER } from "@/lib/auth/test-support";
import { viewerFor, type Viewer } from "@/lib/auth/viewer";
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

/**
 * Run against the real `content/` registries rather than fixtures: the gate is
 * only worth anything if it holds for the problems this deployment actually
 * ships, and a fixture would not catch a contest file that forgot a problem.
 *
 * The clock is the only input moved around, which is exactly the freedom the
 * gate is built on — a problem opens because time passed, not because somebody
 * deployed.
 */
const contests = allContests();
/** Any round this deployment ships: these cases need one to exist, not a
 * particular one. */
const demo = contests[0];

const PREVIEW = viewerWith("problem.viewAll", "an-admin");

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

function after(date: Date): Date {
  return new Date(date.getTime() + 60_000);
}

describe("viewerFor", () => {
  it("匿名与选手都拿不到预览", () => {
    expect(viewerFor(null).can("problem.viewAll")).toBe(false);
    expect(viewerFor({ handle: "p", groups: [] }).can("problem.viewAll")).toBe(
      false,
    );
  });

  it("持有该能力的组拿得到预览", () => {
    expect(viewerWith("problem.viewAll", "a").can("problem.viewAll")).toBe(
      true,
    );
  });

  it("AS_PLAYER 对任何能力都答否", () => {
    for (const capability of CAPABILITIES) {
      expect(AS_PLAYER.can(capability)).toBe(false);
    }
  });

  it("viewer 的答案与 capabilitiesOf 逐项一致，没有第二份定义", () => {
    // The property the whole refactor exists to hold: a viewer derives every
    // answer from the declared groups, so there is nowhere for a capability to
    // be added and then forgotten.
    //
    // Compared against `capabilitiesOf` rather than against `group.capabilities`
    // because the two are no longer the same set — `IMPLIES` adds to it, and
    // asserting the raw declaration would make this fail for a group that holds
    // an implying capability without its implied one.
    for (const group of listGroups()) {
      const viewer = viewerFor({ handle: "x", groups: [group.id] });
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
      handle: "x",
      groups: [...declared.map((g) => g.id), "一个不存在的组"],
    });
    for (const group of declared) {
      for (const capability of group.capabilities) {
        expect(viewer.can(capability)).toBe(true);
      }
    }
  });

  it("未声明的组不带任何能力", () => {
    const viewer = viewerFor({ handle: "x", groups: ["未声明的组-甲", "未声明的组-乙"] });
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

  /**
   * `visibleTo: []` is how a problem says "nobody, ever", and the gate answers
   * it as an audience refusal — the `hidden` tag this used to assert has not
   * existed since the two booleans became one audience.
   *
   * Nothing in `content/` is staged that way today, so this skips rather than
   * sitting inside an `if` that is always false: an assertion nobody can see
   * never running is worse than no assertion, because it reads as coverage.
   */
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

  /**
   * A gate whose default is "yes" is the wrong shape to export. `problemFor`
   * checks for the config first so nothing sees a difference today, which is
   * exactly why this is worth pinning: the next caller might not.
   */
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
    // The only widening argument is the viewer, and a player's viewer has no
    // knob. This is the property the split into two accessors exists to hold.
    const player = problemsFor(viewerFor({ handle: "player", groups: [] }));
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

/**
 * "Seeing a round means seeing its problems", and the half of it that must not
 * hold.
 *
 * Stated as two invariants over the real registries rather than as cases,
 * because the shape they guard against is a content edit away and neither
 * direction is worth anything without the other. The forward one on its own
 * would be satisfied by dropping the phase condition from
 * `reachableViaContest` — which is precisely the bug, and the reverse one is
 * what fails when somebody does.
 *
 * Nothing shipped today can distinguish the two: `audienceCovers` refuses a
 * contest that reaches past its problems at load, so an audience alone cannot
 * produce "sees the round, not the problem", and every problem in the
 * repository is public. The forward case is therefore true for uninteresting
 * reasons right now and becomes load-bearing the moment a private round is
 * added.
 */
describe("能看到比赛与能看到题目的关系", () => {
  /** Enough shapes to cover both override axes and neither. */
  const VIEWERS: Viewer[] = [
    AS_PLAYER,
    viewerFor({ handle: "player", groups: ["一个普通分组"] }),
    PREVIEW,
    { handle: "reader", groups: [], can: (c) => c === "contest.viewAll" },
    {
      handle: "both",
      groups: [],
      can: (c) => c === "contest.viewAll" || c === "problem.viewAll",
    },
  ];

  /**
   * In the round's audience and holding nothing at all.
   *
   * `can` is stubbed rather than resolved from a group, because the point is a
   * viewer with no capability whatever the deployment hands its groups — this
   * is the person the embargo exists for.
   */
  function insiderOf(contest: ContestConfig): Viewer {
    return {
      handle: "insider",
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
              `${viewer.handle} 拿得到 ${contest.slug}，却拿不到它的 ${entry.slug}`,
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

      // The dangerous shape spelled out: they can reach the round, and the
      // round has not opened. Dropping `hasContestStarted` from
      // `reachableViaContest` hands them every statement in it.
      if (contest.visibleTo?.length === 0) continue;
      expect(contestFor(contest.slug, insider)).toBeDefined();

      for (const entry of contest.problems) {
        // Only problems this round alone holds: one that another, already
        // started round also uses is public for that reason.
        if (contestsUsing(entry.slug).length !== 1) continue;

        expect(
          problemFor(entry.slug, insider, at),
          `${contest.slug} 还没开赛，但受众内的普通选手读到了 ${entry.slug}`,
        ).toBeUndefined();
      }
    }
  });

  it("经由比赛读到的题不进题库列表，也交不了", () => {
    // Neither override touches `gate` or `open`, so `problemsFor`'s filter
    // drops both for anybody without `problem.viewAll`, and `submitFor` reads
    // the same `open`. Asserted over every viewer shape because a list is
    // where a widening goes unnoticed — nobody checks a page for absences.
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

/**
 * The axis that does not touch visibility. A retired problem stays readable by
 * whoever it was written for — that is what lets somebody review a round they
 * competed in — while nothing new may be sent to it.
 */
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
    // The invariant that keeps `open` from quietly becoming a second gate:
    // retirement is the only thing that may separate the two.
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

/**
 * The two axes composed, asserted through the gate itself.
 *
 * This block used to recompute `visibleTo.some(...)` inline and assert on
 * that. Nothing in it reached `problemVisibility`, so the first two cases were
 * a test of `Array.prototype.some`: swapping the order of the two axes inside
 * the gate, or dropping one of them, would have left this green. The same
 * shape as the `if (orphan)` case above, and worth no more.
 *
 * Every problem in `content/problems/` is public today, so the audience axis
 * cannot be made to refuse with real content and the case that needs it skips
 * rather than hiding behind a condition that never holds. The phase axis is
 * exercised by moving the clock, which is the one input this file is free to
 * move.
 */
describe("受众与阶段的组合", () => {
  // Two ordinary viewers in different groups. Which groups is immaterial —
  // what the cases below need is that neither carries a capability.
  const inTeam = viewerFor({ handle: "t", groups: ["无能力的组-甲"] });
  const outsider = viewerFor({ handle: "o", groups: ["无能力的组-乙"] });

  /** A problem this deployment has actually given to some group. */
  const gated = allProblems().find((problem) => problem.visibleTo?.length);

  /**
   * And one a contest also holds, which is the only shape that can tell the
   * order of the two axes apart. With no round behind it there is no embargo
   * for an audience refusal to win over, so both orders answer `audience` and
   * the case would prove nothing about which was asked first.
   */
  const contested =
    gated && contestsUsing(gated.slug).length > 0 ? gated : undefined;

  it.skipIf(!gated)("受众不通过就是不通过，与时刻无关", () => {
    const audience = gated!.visibleTo ?? [];
    const excluded = viewerFor({ handle: "nobody", groups: [] });
    const member = viewerFor({ handle: "member", groups: [...audience] });

    for (const now of [new Date("2000-01-01"), new Date("2100-01-01")]) {
      expect(problemVisibility(gated!.slug, excluded, now)).toEqual({
        visible: false,
        reason: "audience",
        audience,
      });
    }

    // The same problem, past the same axis, for somebody in it — so the case
    // above is about the viewer and not about the problem being unreachable.
    expect(
      problemVisibility(gated!.slug, member, new Date("2100-01-01")).visible,
    ).toBe(true);
  });

  it.skipIf(!contested)("受众先于阶段：禁运期内的理由仍是 audience", () => {
    const excluded = viewerFor({ handle: "nobody", groups: [] });
    const opensAt = contestsUsing(contested!.slug)
      .map((contest) => contest.startsAt)
      .reduce((earliest, at) => (at < earliest ? at : earliest));

    // Inside the embargo window, so both axes refuse and the reported reason
    // is the one that was asked first. Reversing them answers `embargo` here,
    // which is what makes this an assertion about the order rather than about
    // the audience.
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

    // Both viewers are in different groups and both pass the audience axis,
    // because the problem declares no audience — which is what makes this a
    // test of the phase axis on its own.
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

    // The override is checked by `problemFor`, not by the gate, so the gate
    // keeps reporting *why* something is withheld even for a holder. That is
    // what lets a console mark a problem as unreleased rather than render it
    // as an ordinary one.
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

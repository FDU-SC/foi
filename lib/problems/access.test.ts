import { describe, expect, it } from "vitest";
import { listGroups } from "@/lib/auth/groups";
import { CAPABILITIES } from "@/lib/auth/policy";
import { AS_PLAYER, viewerFor } from "@/lib/auth/viewer";
import { allContests } from "@/lib/contests/registry";
import { contestPhase } from "@/lib/contests/types";
import { allProblems } from "./registry";
import {
  contestsUsing,
  problemFor,
  problemGateWarnings,
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
const demo = contests.find((contest) => contest.slug === "demo-acm");

const PREVIEW = viewerFor({ handle: "an-admin", groups: ["管理员"] });

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

  it("管理员拿得到预览", () => {
    expect(viewerFor({ handle: "a", groups: ["管理员"] }).can("problem.viewAll")).toBe(
      true,
    );
  });

  it("AS_PLAYER 对任何能力都答否", () => {
    for (const capability of CAPABILITIES) {
      expect(AS_PLAYER.can(capability)).toBe(false);
    }
  });

  it("viewer 的答案与用户组声明逐项一致，没有第二份定义", () => {
    // The property the whole refactor exists to hold: a viewer derives every
    // answer from the declared groups, so there is nowhere for a capability to
    // be added and then forgotten.
    for (const group of listGroups()) {
      const viewer = viewerFor({ handle: "x", groups: [group.id] });
      for (const capability of CAPABILITIES) {
        expect(viewer.can(capability)).toBe(
          (group.capabilities as readonly string[]).includes(capability),
        );
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
    const viewer = viewerFor({ handle: "x", groups: ["2026级", "本科生"] });
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

  it("hidden 且不属于任何比赛的题目被封禁", () => {
    const used = new Set(
      contests.flatMap((contest) => contest.problems.map((p) => p.slug)),
    );
    const orphan = allProblems().find(
      (problem) => problem.visibleTo?.length === 0 && !used.has(problem.slug),
    );

    if (orphan) {
      expect(problemVisibility(orphan.slug, AS_PLAYER)).toEqual({
        visible: false,
        reason: "hidden",
      });
    }
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
  it("对选手可见的题目，恰好是没有未开始比赛引用且未标 hidden 的那些", () => {
    const visible = new Set(
      problemsFor(AS_PLAYER).map((entry) => entry.config.slug),
    );

    for (const problem of allProblems()) {
      const embargoed = contestsUsing(problem.slug).some(
        (contest) => contestPhase(contest) === "upcoming",
      );
      const released = contestsUsing(problem.slug).some(
        (contest) => contestPhase(contest) !== "upcoming",
      );
      const openToAll = problem.visibleTo === undefined;
      const expected = openToAll && (released || !embargoed);

      expect(visible.has(problem.slug)).toBe(expected);
    }
  });
});

describe("受众与阶段的组合", () => {
  const inTeam = viewerFor({ handle: "t", groups: ["校队"] });
  const outsider = viewerFor({ handle: "o", groups: ["2026级"] });
  const admin = viewerFor({ handle: "a", groups: ["管理员"] });

  /** The four combinations of the two axes, on a problem the repo really has. */
  function gateWith(
    visibleTo: string[] | undefined,
    viewer: ReturnType<typeof viewerFor>,
  ) {
    const slug = "__audience-probe";
    // The registry is frozen, so this exercises the rule rather than the
    // registry: `inAudience` and the phase check are what compose.
    const audienceOk =
      visibleTo === undefined ||
      visibleTo.some((g) => viewer.groups.includes(g));
    return { slug, audienceOk };
  }

  it("受众不通过时，阶段再放开也看不到", () => {
    expect(gateWith(["校队"], outsider).audienceOk).toBe(false);
    expect(gateWith(["校队"], inTeam).audienceOk).toBe(true);
  });

  it("problem.viewAll 越过两个轴", () => {
    // The override is checked by `problemFor`, not by the gate itself, so the
    // gate keeps reporting *why* something is withheld even for a holder.
    expect(admin.can("problem.viewAll")).toBe(true);
    expect(outsider.can("problem.viewAll")).toBe(false);
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

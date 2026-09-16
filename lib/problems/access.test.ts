import { describe, expect, it } from "vitest";
import { AS_PLAYER } from "@/test/auth-support";
import { allows } from "@/lib/authz/engine";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import {
  archivedProblem,
  sealedProblem,
  stagedProblem,
  upcomingProblem,
  upsolveProblem,
  viewerWith,
} from "@/test/content-shapes";
import { contestFor } from "@/lib/contests/access";
import { contestProblemRefs } from "@/lib/contests/refs";
import { allContests } from "@/lib/contests/registry";
import { hasContestStarted, showsStatements } from "@/lib/contests/types";
import { allProblems } from "./registry";
import { problemFor, problemStatus, problemsFor } from "./access";

const contests = allContests();

const PREVIEW = viewerWith("problem.read", 100);

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

function after(date: Date): Date {
  return new Date(date.getTime() + 60_000);
}

describe("题目只经比赛可达", () => {
  it("每一条 ref 都能用它的两个 slug 取回来", () => {
    expect(contestProblemRefs().length).toBeGreaterThan(0);

    for (const ref of contestProblemRefs()) {
      const at = ref.contest.startsAt;
      const view = problemFor(ref.contest.slug, ref.problem.slug, PREVIEW, at);
      expect(view?.ref.problem.slug, ref.problem.slug).toBe(ref.problem.slug);
    }
  });

  it("换一场没带这道题的比赛就取不到，哪怕两者都存在", () => {
    const ref = contestProblemRefs()[0];
    const elsewhere = contests.find(
      (contest) =>
        contest.slug !== ref.contest.slug &&
        !contest.problems.some((entry) => entry.slug === ref.problem.slug),
    );
    if (!elsewhere) return;

    expect(
      problemFor(elsewhere.slug, ref.problem.slug, PREVIEW),
    ).toBeUndefined();
  });

  it("题目不存在与比赛不存在的返回值一样，都不透露对方存在", () => {
    const ref = contestProblemRefs()[0];

    expect(problemFor(ref.contest.slug, "no-such-problem", PREVIEW)).toBe(
      undefined,
    );
    expect(problemFor("no-such-contest", ref.problem.slug, PREVIEW)).toBe(
      undefined,
    );
  });
});

describe("开赛前后", () => {
  it("未开赛：受众内的普通选手也读不到，预览者读得到并被标出", () => {
    const ref = upcomingProblem();
    const at = before(ref.contest.startsAt);
    const insider = viewerFor({ uid: 9, groups: [...(ref.contest.visibleTo ?? [])] });

    expect(contestFor(ref.contest.slug, insider, at)).toBeDefined();
    expect(
      problemFor(ref.contest.slug, ref.problem.slug, insider, at),
    ).toBeUndefined();

    const preview = problemFor(ref.contest.slug, ref.problem.slug, PREVIEW, at);
    expect(preview?.preview).toBe(true);
  });

  it("开赛当刻即放开，且不再算预览", () => {
    const ref = upcomingProblem();
    const insider = viewerFor({ uid: 9, groups: [...(ref.contest.visibleTo ?? [])] });

    const view = problemFor(
      ref.contest.slug,
      ref.problem.slug,
      insider,
      ref.contest.startsAt,
    );
    expect(view?.preview).toBe(false);
  });

  it("受众为空的轮次任何时刻都不放行，开赛与否无关", () => {
    const ref = stagedProblem();
    const nobody = viewerFor({ uid: 12, groups: [] });

    for (const at of [before(ref.contest.startsAt), after(ref.contest.endsAt)]) {
      expect(
        problemFor(ref.contest.slug, ref.problem.slug, nobody, at),
      ).toBeUndefined();
    }
  });
});

describe("比赛结束之后，去向由它自己声明", () => {
  it("归档：题面还在，但交不了也动不了", () => {
    const ref = archivedProblem();

    expect(problemFor(ref.contest.slug, ref.problem.slug, AS_PLAYER)).toBeDefined();
    expect(allows("problem.submit", ref, PREVIEW)).toBe(false);
    expect(allows("problem.invoke", ref, PREVIEW)).toBe(false);
  });

  it("赛后仍收题：题面在，提交与交互也还开着", () => {
    const ref = upsolveProblem();
    const entrant = viewerFor({ uid: 21, groups: [] });

    expect(problemFor(ref.contest.slug, ref.problem.slug, AS_PLAYER)).toBeDefined();
    expect(allows("problem.submit", ref, entrant)).toBe(true);
    expect(allows("problem.invoke", ref, entrant)).toBe(true);
  });

  it("封存：连题面一起收起来，只有预览者还看得到", () => {
    const ref = sealedProblem();

    expect(
      problemFor(ref.contest.slug, ref.problem.slug, AS_PLAYER),
    ).toBeUndefined();
    expect(
      problemFor(ref.contest.slug, ref.problem.slug, PREVIEW)?.preview,
    ).toBe(true);
  });

  it("同一道题在三场比赛里的去向互不影响", () => {
    const archived = archivedProblem();
    const sealed = sealedProblem();
    if (archived.problem.slug !== sealed.problem.slug) return;

    expect(
      problemFor(archived.contest.slug, archived.problem.slug, AS_PLAYER),
    ).toBeDefined();
    expect(
      problemFor(sealed.contest.slug, sealed.problem.slug, AS_PLAYER),
    ).toBeUndefined();
  });
});

describe("problemsFor", () => {
  it("列出的恰好是这场比赛此刻对本人开放的那些", () => {
    for (const contest of contests) {
      const listed = new Set(
        problemsFor(contest.slug, AS_PLAYER).map((view) => view.ref.problem.slug),
      );

      const expected =
        contest.visibleTo === undefined && showsStatements(contest)
          ? contest.problems.map((entry) => entry.slug)
          : [];

      expect([...listed].sort(), contest.slug).toEqual([...expected].sort());
    }
  });

  it("选手视角下没有一道是预览", () => {
    for (const contest of contests) {
      for (const view of problemsFor(contest.slug, AS_PLAYER)) {
        expect(view.preview).toBe(false);
      }
    }
  });

  it("不存在的比赛列出空表而不是抛错", () => {
    expect(problemsFor("no-such-contest", PREVIEW)).toEqual([]);
  });
});

describe("能看到比赛与能看到题目的关系", () => {
  const VIEWERS: Viewer[] = [
    AS_PLAYER,
    viewerFor({ uid: 6, groups: ["一个普通分组"] }),
    PREVIEW,
  ];

  it("已开赛且未封存：拿得到比赛的人，拿得到它的每一道题", () => {
    expect(contests.length).toBeGreaterThan(0);

    for (const contest of contests) {
      for (const now of [contest.startsAt, after(contest.endsAt)]) {
        expect(hasContestStarted(contest, now)).toBe(true);
        if (!showsStatements(contest, now)) continue;

        for (const viewer of VIEWERS) {
          if (!contestFor(contest.slug, viewer, now)) continue;

          for (const entry of contest.problems) {
            expect(
              problemFor(contest.slug, entry.slug, viewer, now),
              `${viewer.uid} 拿得到 ${contest.slug}，却拿不到它的 ${entry.slug}`,
            ).toBeDefined();
          }
        }
      }
    }
  });
});

describe("孤儿题", () => {
  it("每道题都至少属于一场比赛，否则它没有任何 URL", () => {
    const carried = new Set(
      contestProblemRefs().map((ref) => ref.problem.slug),
    );

    for (const problem of allProblems()) {
      expect(carried.has(problem.slug), problem.slug).toBe(true);
    }
  });
});

describe("problemStatus", () => {
  it("比赛还带着这道题时是 live，标题来自注册表而不是快照", () => {
    const ref = contestProblemRefs()[0];

    expect(problemStatus(ref.contest.slug, ref.problem.slug, "陈旧的快照")).toEqual(
      { kind: "live", title: ref.problem.title },
    );
  });

  it("比赛不再带着它时是 gone，只剩镜像行里的快照可用", () => {
    const ref = contestProblemRefs()[0];

    expect(problemStatus(ref.contest.slug, "__removed-long-ago", "当年的标题")).toEqual(
      { kind: "gone", title: "当年的标题" },
    );
    expect(problemStatus("__deleted-contest", ref.problem.slug, "当年的标题")).toEqual(
      { kind: "gone", title: "当年的标题" },
    );
  });
});

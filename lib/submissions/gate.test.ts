import { describe, expect, it } from "vitest";
import { allows } from "@/lib/authz/engine";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { DEFAULT_SUBMIT_RATE_LIMIT } from "@/lib/problems/types";
import {
  archivedProblem,
  contestWithGroupEntry,
  groupWith,
  openContestProblem,
  sealedProblem,
  upcomingProblem,
  upsolveProblem,
  viewerWith,
} from "@/test/content-shapes";
import { submitFor } from "./gate";

const { contest: CONTEST, entry: ENTRY, group: GROUP } = contestWithGroupEntry();

const DURING = new Date(CONTEST.startsAt.getTime() + 60_000);
const AFTER = new Date(CONTEST.endsAt.getTime() + 60_000);

function user(groups: string[]): Viewer {
  return viewerFor({ uid: 10, groups });
}

const ENTRANT = user([GROUP]);
const OUTSIDE_THE_LIST = user([]);

function refusalOf(
  contestSlug: string,
  problemSlug: string,
  viewer: Viewer,
  now: Date,
): string | undefined {
  const gate = submitFor(contestSlug, problemSlug, viewer, now);
  return gate.ok ? undefined : gate.denial.reason.code;
}

describe("submitFor 放行时", () => {
  it("给出这道题在这场比赛里的那份引用", () => {
    const gate = submitFor(CONTEST.slug, ENTRY.slug, ENTRANT, DURING);

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    expect(gate.ref.contest.slug).toBe(CONTEST.slug);
    expect(gate.ref.problem.slug).toBe(ENTRY.slug);
  });

  it("节流用的是比赛条目上的那个，而不是题目自己的", () => {
    const gate = submitFor(CONTEST.slug, ENTRY.slug, ENTRANT, DURING);

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    expect(gate.rateLimit).toEqual(ENTRY.rateLimit);
    expect(gate.rateLimit).not.toEqual(DEFAULT_SUBMIT_RATE_LIMIT);
  });

  it("比赛条目没覆盖时落回题目自己的节流", () => {
    const ref = openContestProblem();
    if (ref.entry.rateLimit) return;

    const gate = submitFor(ref.contest.slug, ref.problem.slug, ENTRANT);

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    expect(gate.rateLimit).toEqual(
      ref.problem.submit.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT,
    );
  });

  it("比赛声明了赛后收题时，结束之后仍然放行", () => {
    const ref = upsolveProblem();
    const gate = submitFor(ref.contest.slug, ref.problem.slug, ENTRANT);

    expect(gate.ok).toBe(true);
  });
});

describe("submitFor 的拒绝", () => {
  it("题目不在这场比赛里是 contest-mismatch", () => {
    expect(refusalOf(CONTEST.slug, "没有这道题", ENTRANT, DURING)).toBe(
      "contest-mismatch",
    );
  });

  it("比赛不存在时同样是 contest-mismatch，不透露题目存不存在", () => {
    for (const slug of ["没有这场比赛", ""]) {
      expect(refusalOf(slug, ENTRY.slug, ENTRANT, DURING)).toBe(
        "contest-mismatch",
      );
    }
  });

  it("匿名的人交不了任何题", () => {
    expect(refusalOf(CONTEST.slug, ENTRY.slug, viewerFor(null), DURING)).toBe(
      "unauthenticated",
    );
  });

  it("比赛已结束时拒绝，并说明是比赛不收题", () => {
    expect(refusalOf(CONTEST.slug, ENTRY.slug, ENTRANT, AFTER)).toBe(
      "contest-closed",
    );
  });

  it("已归档的比赛题面还读得到，提交仍被拒", () => {
    const ref = archivedProblem();
    expect(refusalOf(ref.contest.slug, ref.problem.slug, ENTRANT, new Date())).toBe(
      "contest-closed",
    );
  });

  it("比赛进行中但不在名单里时是 not-entered", () => {
    expect(refusalOf(CONTEST.slug, ENTRY.slug, OUTSIDE_THE_LIST, DURING)).toBe(
      "not-entered",
    );
  });
});

describe("submitFor 的试交", () => {
  /** May open problems before they start, and may trial what they can open. */
  const TESTER = viewerFor({
    uid: 11,
    groups: [groupWith("problem.read"), groupWith("problem.trial")],
  });
  const TRIAL_ONLY = viewerWith("problem.trial", 12);

  it("开赛前能预览的人可以试交，节流与正式提交相同", () => {
    const ref = upcomingProblem();
    const gate = submitFor(ref.contest.slug, ref.problem.slug, TESTER);

    expect(gate).toMatchObject({ ok: true, trial: true });
    if (!gate.ok) return;
    expect(gate.ref.contest.slug).toBe(ref.contest.slug);
    expect(gate.ref.problem.slug).toBe(ref.problem.slug);
    expect(gate.rateLimit).toEqual(
      ref.entry.rateLimit ?? ref.problem.submit.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT,
    );
  });

  it("能参赛时照常参赛，不会变成试交", () => {
    const ref = openContestProblem();
    expect(submitFor(ref.contest.slug, ref.problem.slug, TESTER)).toMatchObject({
      ok: true,
      trial: false,
    });
  });

  it("不在参赛名单里时，看得到题面就能试交", () => {
    expect(submitFor(CONTEST.slug, ENTRY.slug, TRIAL_ONLY, DURING)).toMatchObject({
      ok: true,
      trial: true,
    });
  });

  it("看不到题面的题目不能试交，拒绝理由仍是参赛那一层的", () => {
    const upcoming = upcomingProblem();
    expect(refusalOf(upcoming.contest.slug, upcoming.problem.slug, TRIAL_ONLY, new Date()))
      .toBe("contest-closed");

    const sealed = sealedProblem();
    expect(refusalOf(sealed.contest.slug, sealed.problem.slug, TRIAL_ONLY, new Date()))
      .toBe("contest-closed");
    expect(submitFor(sealed.contest.slug, sealed.problem.slug, TESTER)).toMatchObject({
      ok: true,
      trial: true,
    });
  });

  it("没有试交权限的人得到的拒绝与原来相同", () => {
    const ref = upcomingProblem();
    expect(refusalOf(ref.contest.slug, ref.problem.slug, viewerWith("problem.read"), new Date()))
      .toBe("contest-closed");
  });

  it("题目不在这场比赛里时，试交同样是 contest-mismatch", () => {
    expect(refusalOf(CONTEST.slug, "没有这道题", TESTER, DURING)).toBe("contest-mismatch");
  });

  it("匿名的人不能试交", () => {
    const ref = upcomingProblem();
    const anonymous = viewerFor(null);
    expect(refusalOf(ref.contest.slug, ref.problem.slug, anonymous, new Date()))
      .toBe("unauthenticated");
    expect(allows("problem.trial", ref, anonymous)).toBe(false);
  });
});

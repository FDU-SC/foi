import { describe, expect, it } from "vitest";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { DEFAULT_SUBMIT_RATE_LIMIT } from "@/lib/problems/types";
import {
  archivedProblem,
  contestWithGroupEntry,
  openContestProblem,
  upsolveProblem,
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

import { describe, expect, it } from "vitest";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { DEFAULT_SUBMIT_RATE_LIMIT } from "@/lib/problems/types";
import {
  contestWithGroupEntry,
  publicProblemOutside,
  retiredProblem,
} from "@/test/content-shapes";
import { submitFor } from "./gate";

const { contest: CONTEST, entry: ENTRY, group: GROUP } = contestWithGroupEntry();

const DURING = new Date(CONTEST.startsAt.getTime() + 60_000);
const AFTER = new Date(CONTEST.endsAt.getTime() + 60_000);

const OUTSIDER = publicProblemOutside(CONTEST, DURING);

function user(groups: string[]): Viewer {
  return viewerFor({ uid: 10, groups });
}

const ENTRANT = user([GROUP]);
const OUTSIDE_THE_LIST = user([]);

function refusalOf(
  slug: string,
  contestSlug: string | null,
  viewer: Viewer,
  now: Date,
): string | undefined {
  const gate = submitFor(slug, contestSlug, viewer, now);
  return gate.ok ? undefined : gate.denial.reason.code;
}

describe("submitFor 放行时", () => {
  it("赛外提交给出题目、空比赛与题目自己的节流", () => {
    const gate = submitFor(ENTRY.slug, null, OUTSIDE_THE_LIST, DURING);

    expect(gate).toMatchObject({ ok: true, contest: null });
    if (!gate.ok) return;

    expect(gate.problem.slug).toBe(ENTRY.slug);
    expect(gate.rateLimit).toEqual(
      gate.problem.submit.rateLimit ?? DEFAULT_SUBMIT_RATE_LIMIT,
    );
  });

  it("赛内提交用的是比赛条目上的节流，而不是题目自己的", () => {
    const gate = submitFor(ENTRY.slug, CONTEST.slug, ENTRANT, DURING);

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;

    expect(gate.contest?.slug).toBe(CONTEST.slug);
    expect(gate.rateLimit).toEqual(ENTRY.rateLimit);
    expect(gate.rateLimit).not.toEqual(DEFAULT_SUBMIT_RATE_LIMIT);
  });
});

describe("submitFor 的拒绝", () => {
  it("题目不存在时说题目不存在", () => {
    expect(refusalOf("没有这道题", null, ENTRANT, DURING)).toBe("not-found");
  });

  it("下架的题目拒绝提交，尽管题面仍然可读", () => {
    expect(refusalOf(retiredProblem().slug, null, ENTRANT, DURING)).toBe(
      "retired",
    );
  });

  it("匿名的人交不了任何题", () => {
    expect(refusalOf(ENTRY.slug, null, viewerFor(null), DURING)).toBe(
      "unauthenticated",
    );
  });

  it("比赛已结束时拒绝，并说明是比赛不收题", () => {
    expect(refusalOf(ENTRY.slug, CONTEST.slug, ENTRANT, AFTER)).toBe(
      "contest-closed",
    );
  });

  it("比赛不包含这道题时是 contest-mismatch", () => {
    expect(refusalOf(OUTSIDER.slug, CONTEST.slug, ENTRANT, DURING)).toBe(
      "contest-mismatch",
    );
  });

  it("比赛不存在时同样是 contest-mismatch", () => {
    expect(refusalOf(ENTRY.slug, "没有这场比赛", ENTRANT, DURING)).toBe(
      "contest-mismatch",
    );
  });

  it("比赛进行中但不在名单里时是 not-entered", () => {
    expect(refusalOf(ENTRY.slug, CONTEST.slug, OUTSIDE_THE_LIST, DURING)).toBe(
      "not-entered",
    );
  });

  it("题目不存在时先答题目不存在，不泄露比赛的组成", () => {
    expect(refusalOf("没有这道题", CONTEST.slug, OUTSIDE_THE_LIST, DURING)).toBe(
      "not-found",
    );
  });
});

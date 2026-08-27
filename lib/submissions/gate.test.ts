import { describe, expect, it } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";
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

function user(groups: string[]): Pick<ResolvedUser, "uid" | "groups"> {
  return { uid: 10, groups };
}

const ENTRANT = user([GROUP]);
const OUTSIDE_THE_LIST = user([]);

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

describe("submitFor 的三种拒绝", () => {
  it("题目不存在时是 no-problem", () => {
    const gate = submitFor("没有这道题", null, ENTRANT, DURING);

    expect(gate).toEqual({ ok: false, reason: "no-problem" });
  });

  it("下架的题目同样是 no-problem，尽管题面仍然可读", () => {
    const gate = submitFor(retiredProblem().slug, null, ENTRANT, DURING);

    expect(gate).toEqual({ ok: false, reason: "no-problem" });
  });

  it("比赛已结束时是 contest-mismatch", () => {
    const gate = submitFor(ENTRY.slug, CONTEST.slug, ENTRANT, AFTER);

    expect(gate).toEqual({ ok: false, reason: "contest-mismatch" });
  });

  it("比赛不包含这道题时也是 contest-mismatch", () => {
    const gate = submitFor(OUTSIDER.slug, CONTEST.slug, ENTRANT, DURING);

    expect(gate).toEqual({ ok: false, reason: "contest-mismatch" });
  });

  it("比赛不存在时同样是 contest-mismatch", () => {
    const gate = submitFor(ENTRY.slug, "没有这场比赛", ENTRANT, DURING);

    expect(gate).toEqual({ ok: false, reason: "contest-mismatch" });
  });

  it("比赛进行中但不在名单里时是 not-entered", () => {
    const gate = submitFor(ENTRY.slug, CONTEST.slug, OUTSIDE_THE_LIST, DURING);

    expect(gate).toEqual({ ok: false, reason: "not-entered" });
  });

  it("题目不可见时先答 no-problem，不泄露比赛的组成", () => {
    const gate = submitFor("没有这道题", CONTEST.slug, OUTSIDE_THE_LIST, DURING);

    expect(gate).toEqual({ ok: false, reason: "no-problem" });
  });
});

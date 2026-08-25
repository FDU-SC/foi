import { describe, expect, it } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";
import { DEFAULT_SUBMIT_RATE_LIMIT } from "@/lib/problems/types";
import {
  contestWithGroupEntry,
  publicProblemOutside,
  retiredProblem,
} from "@/test/content-shapes";
import { submitFor } from "./gate";

/**
 * The three refusals, asserted against the gate rather than through the route.
 *
 * `submit-route.db.test.ts` already drives the handler, and it needs a
 * database, a stubbed session and a stubbed judge to reach a decision that
 * touches none of them. Asking the gate directly is what makes it cheap enough
 * to cover every branch — and the distinctions are the point of the module, so
 * they should be pinned where they are made rather than one status-code
 * mapping away.
 *
 * Everything below reads the real registries, because the gate does. What it
 * must not do is quietly read *different* facts than it was written for, so the
 * round is located by shape rather than by slug and every fact it supplies is
 * taken from the registry — content that cannot satisfy the shape fails this
 * file loudly instead of turning its cases vacuous.
 */

const { contest: CONTEST, entry: ENTRY, group: GROUP } = contestWithGroupEntry();

/** Inside the round's window, so the phase is `running`. */
const DURING = new Date(CONTEST.startsAt.getTime() + 60_000);
const AFTER = new Date(CONTEST.endsAt.getTime() + 60_000);

/**
 * A problem this contest does not reference, so naming the two together is a
 * mismatch rather than a permission question. Taken through the access layer at
 * `DURING`, so it is one that is genuinely open then.
 */
const OUTSIDER = publicProblemOutside(CONTEST, DURING);

function user(groups: string[]): Pick<ResolvedUser, "handle" | "groups"> {
  return { handle: "gate-alice", groups };
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

  /**
   * The reason the gate resolves the throttle instead of handing back the
   * contest and letting the route look the entry up again: the number lives on
   * the entry, which only this code has located.
   */
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

  /**
   * Retirement is the case worth having separately: the statement stays
   * readable to whoever competed on it, and `open` is what withholds it. A gate
   * that asked `gate.visible` instead would accept submissions to a problem
   * withdrawn mid-round, which is exactly when somebody has found a fault in it.
   */
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

  /**
   * Separated from the 400 above because the answer is different, and the
   * separation is load-bearing: while this was folded in, a closed round's
   * entry rule decided who appeared on the scoreboard and nothing stopped an
   * outsider putting work on its judges.
   */
  it("比赛进行中但不在名单里时是 not-entered", () => {
    const gate = submitFor(ENTRY.slug, CONTEST.slug, OUTSIDE_THE_LIST, DURING);

    expect(gate).toEqual({ ok: false, reason: "not-entered" });
  });

  /**
   * Order matters: a problem the caller may not have must answer 404 before the
   * contest is ever considered, or the 400 and 403 below it would confirm which
   * problems a round contains to somebody who cannot see them.
   */
  it("题目不可见时先答 no-problem，不泄露比赛的组成", () => {
    const gate = submitFor("没有这道题", CONTEST.slug, OUTSIDE_THE_LIST, DURING);

    expect(gate).toEqual({ ok: false, reason: "no-problem" });
  });
});

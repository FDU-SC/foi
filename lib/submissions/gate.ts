import type { ResolvedUser } from "@/lib/accounts/types";
import { viewerFor } from "@/lib/permissions/viewer";
import { contestEntryFor } from "@/lib/contests/access";
import type { ContestConfig } from "@/lib/contests/types";
import { problemFor } from "@/lib/problems/access";
import {
  submitRateLimit,
  type ActionRateLimit,
  type ProblemConfig,
} from "@/lib/problems/types";

/**
 * How anything obtains permission to queue work on a judge.
 *
 * The same shape as the problem, contest, action and backend gates, and here
 * for the reason all of them exist: this sequence — the problem gate, then the
 * round the client named — must not be spelled out as loose statements in a
 * handler.
 *
 * The round half is `contestEntryFor` in `lib/contests/access.ts`, shared with
 * the statement page and the action route. What stays here is the problem gate
 * in front of it and the last line behind it. An action wants a contest it
 * cannot honour to become no contest at all, because a backend keying quotas on
 * a round must not be told a round the player is not in; a submission wants to
 * be refused and told why. Same four facts, different last line.
 *
 * Unlike `actionFor`, refusals are not collapsed into `undefined`. That gate
 * answers 404 to everything because the distinctions themselves are the leak —
 * saying `spawn` exists on a problem you cannot see confirms the problem, and
 * saying `poll` is not declared enumerates what is. Here the distinctions are
 * safe, and each one is a different answer worth giving:
 *
 * - `no-problem` is 404, and is the only refusal that can withhold something.
 *   Everything below it has already passed the problem gate, so the caller can
 *   read the statement and there is nothing left to conceal.
 * - `contest-mismatch` is 400, because the request is malformed rather than
 *   refused: the client named a contest that is not open, cannot be seen, or
 *   does not contain this problem, and no retry with the same arguments works.
 * - `not-entered` is 403, and separating it from the above is what makes it
 *   useful. The contest is real, visible and open; this person simply is not
 *   in it, and telling them so is the only way they find out. Folding it into
 *   the 400 once meant a closed round's entry rule decided who appeared on the
 *   scoreboard while anybody could still put work on its judges.
 */
export type SubmitGate =
  | {
      ok: true;
      problem: ProblemConfig;
      /** Null for a submission made outside any round, which is allowed. */
      contest: ContestConfig | null;
      /**
       * The throttle that applies, already resolved.
       *
       * Returned rather than left to the caller because the number can only be
       * read off the contest's entry for this problem, and finding that entry
       * is work this gate has already done in order to answer whether the
       * contest contains the problem at all. Handing back the contest and
       * letting the route look again would be a second place for the two to
       * disagree about which entry matched.
       */
      rateLimit: ActionRateLimit;
    }
  | { ok: false; reason: "no-problem" | "contest-mismatch" | "not-entered" };

/**
 * The user rather than the user and a viewer.
 *
 * `viewerFor` is called here rather than passed in. Two parameters carrying one
 * identity can be handed arguments that disagree — a viewer built for one
 * account beside another account's groups typechecks perfectly and authorises
 * the wrong person — and nothing about the call site would show it. Deriving it
 * costs one Set.
 *
 * `Pick` rather than `ResolvedUser`, because a handle and a group list is
 * genuinely all that either `viewerFor` or `canEnterContest` reads, and asking
 * for a whole account row would put this gate out of reach of any caller that
 * has not loaded one.
 */
export function submitFor(
  slug: string,
  contestSlug: string | null | undefined,
  user: Pick<ResolvedUser, "handle" | "groups">,
  now = new Date(),
): SubmitGate {
  const viewer = viewerFor(user);

  // This person's own view, then `open` on top of it. Three conditions folded
  // into one field, because they rule out different people: not theirs to see;
  // theirs to see but not started, which is why a holder of `problem.viewAll`
  // proofreading a round does not get to put work on its judges; or retired,
  // where the statement stays readable and nothing new is accepted.
  //
  // Not `AS_PLAYER`: a problem given to 校队 has no audience under a viewer
  // with no groups, so the very members it was written for would be refused.
  const open = problemFor(slug, viewer, now);
  if (!open?.open) return { ok: false, reason: "no-problem" };

  const problem = open.config;

  // Absent rather than empty. `null`/`undefined` is a submission made outside
  // any round, which is a legitimate thing to want; `""` is a client naming a
  // contest and naming it wrong, and it falls through to the same
  // `contest-mismatch` any other slug that resolves to nothing gets. Accepting
  // it as "no contest" would make the empty string the one malformed value
  // that silently succeeds, as practice.
  if (contestSlug === null || contestSlug === undefined) {
    return { ok: true, problem, contest: null, rateLimit: submitRateLimit(problem) };
  }

  // The client supplies the contest, so every fact about it is re-derived —
  // by the same function the statement page and the action route use, since
  // all three want the same four facts and differ only in what they do with a
  // refusal. Here they are handed on, because each is a different answer worth
  // giving.
  const round = contestEntryFor(contestSlug, slug, user, now);
  if (!round.ok) return { ok: false, reason: round.reason };

  return {
    ok: true,
    problem,
    contest: round.contest,
    rateLimit: submitRateLimit(problem, round.problemEntry.rateLimit),
  };
}

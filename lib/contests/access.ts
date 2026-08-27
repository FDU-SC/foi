import { normalizeHandle, type ResolvedUser } from "@/lib/accounts/types";
import { inAudience, type Audience } from "@/lib/permissions/audience";
import { viewerFor, type Viewer } from "@/lib/permissions/viewer";
import { allContests, contestBySlug } from "./registry";
import {
  hasContestStarted,
  isContestOpen,
  type ContestClock,
  type ContestConfig,
  type ContestProblemConfig,
} from "./types";

/**
 * How anything that renders to a person obtains a contest, and who may enter
 * one.
 *
 * Same shape and same reasoning as `lib/problems/access.ts`: the gate sits at
 * the point of retrieval, so there is no way to ask for a contest without
 * saying who is asking, and no page has to remember a second filtering step.
 *
 * A contest carries two audiences that are not the same set, and both are
 * answered here so that nobody has to go looking for the second one.
 * `visibleTo` decides who may *read* about the round; `participants` decides
 * who may *compete* in it. A round announced to the whole school and entered
 * by the team it was written for is the ordinary case, not an edge one.
 */

export type ContestVisibility =
  | { visible: true }
  | { visible: false; reason: "audience"; audience: Audience };

export interface ContestView {
  config: ContestConfig;
  gate: ContestVisibility;
}

/**
 * Whether `contest` may be shown to this viewer.
 *
 * Only the audience: unlike a problem, a contest is not gated on its own
 * phase. An unstarted round is an announcement — its title and schedule are
 * how people know to turn up — and what it withholds is the problem set, which
 * `isContestProblemSetVisibleTo` answers separately.
 */
export function contestVisibility(
  contest: ContestConfig,
  viewer: Viewer,
): ContestVisibility {
  return inAudience(contest.visibleTo, viewer)
    ? { visible: true }
    : { visible: false, reason: "audience", audience: contest.visibleTo };
}

/** Every contest this viewer may be shown, newest first. */
export function contestsFor(viewer: Viewer): ContestView[] {
  const override = viewer.can("contest.viewAll");
  return allContests()
    .map((config) => ({ config, gate: contestVisibility(config, viewer) }))
    .filter((entry) => override || entry.gate.visible);
}

/**
 * One contest, or `undefined` when this viewer may not have it.
 *
 * `contestBySlug` does not filter on the audience, so reaching for it directly
 * leaves a contest kept off the index page readable by anyone who knows its
 * slug.
 */
export function contestFor(
  slug: string,
  viewer: Viewer,
): ContestView | undefined {
  const config = contestBySlug(slug);
  if (!config) return undefined;

  const gate = contestVisibility(config, viewer);
  if (!gate.visible && !viewer.can("contest.viewAll")) return undefined;

  return { config, gate };
}

/**
 * Whether this person may enter this contest.
 *
 * Asked on the submission path, not only when drawing the board: gating the
 * standings alone lets any account attribute submissions to a closed contest
 * and occupy its judges with them, the entries simply never showing up.
 *
 * Here rather than beside the database queries, because it is the second
 * contest gate: `contestFor` says who may read the round, this says who may
 * compete in it, and a reader looking for one will want the other. It also
 * keeps a question about a config object and a group list from dragging a
 * connection pool in behind it.
 *
 * A `Viewer` is deliberately not what this takes, unlike every gate above it.
 * Entry is not a capability question — no capability enters you into a closed
 * round, and `contest.viewAll` explicitly must not, or reading a round would
 * be competing in it. What it needs is the *account*: a handle that is really
 * somebody's, which `Viewer.handle` is allowed to be null for.
 *
 * Cheap on purpose: `groups` is already resolved on the user, and a `list` is a
 * handful of handles, so this costs nothing and needs no snapshot.
 */
export function canEnterContest(
  contest: ContestConfig,
  user: Pick<ResolvedUser, "handle" | "groups">,
): boolean {
  switch (contest.participants.mode) {
    case "open":
      return true;
    case "list": {
      const handle = normalizeHandle(user.handle);
      return contest.participants.handles.some(
        (entry) => normalizeHandle(entry) === handle,
      );
    }
    case "group":
      return user.groups.includes(contest.participants.group);
  }
}

/**
 * Whether this viewer may have a contest's problem set.
 *
 * Separate from whether the contest itself may be shown, because the leak is
 * different: the problem set gives away the shape of the round — how many
 * problems, what they are called, what they are worth — without opening a
 * single statement. So an upcoming contest has a public page and a withheld
 * problem list.
 *
 * Both halves — the clock and the proofreader's override — belong in this one
 * predicate. Every page that draws a problem set needs both, nothing
 * downstream re-checks (the labels and point values go straight into the
 * HTML), so a page that spells out one half of the rule publishes the shape of
 * an unstarted round. That is the failure `lib/submissions/access.ts` opens on,
 * one page earlier.
 *
 * The override is `problem.viewAll` and not `contest.viewAll`: what is
 * withheld here is problems, and whoever may read an unopened statement may
 * certainly read its label and what it is worth.
 */
export function isContestProblemSetVisibleTo(
  contest: ContestClock,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return hasContestStarted(contest, now) || viewer.can("problem.viewAll");
}

/**
 * The round a submission or an interactive action belongs to, re-derived from
 * the slug the client supplied.
 *
 * Four facts have to hold together, and any call site that spells out three of
 * them has not written a weaker gate, it has written a different one. Drop
 * `gate.visible`, for instance, and a holder of `contest.viewAll` opening
 * `?contest=<staged round>` gets that round's breadcrumb and has its slug
 * handed to the submit panel, for an attribution the API then refuses.
 *
 * The facts, in this order:
 *
 *   1. the contest resolves and this person may *read* it — `gate.visible`
 *      rather than the bare view, so reaching a round through
 *      `contest.viewAll` stays reading it rather than competing in it
 *   2. it contains this problem
 *   3. it is open — `isContestOpen`, so the freeze does not end the round
 *   4. this person may enter it
 *
 * Refusals are tagged because `submitFor` owes its caller the difference: a
 * round that is over is a malformed request, a round somebody is not in is a
 * refusal they can act on. The two callers that want a contest or nothing —
 * the statement page and the action route, where naming a round the player is
 * not in must become naming no round at all — collapse both to null at the
 * call site, which is the only part deliberately left outside.
 *
 * The account rather than a `Viewer`, and the viewer derived here: entry keys
 * on a handle that is really somebody's, and two parameters carrying one
 * identity can be handed arguments that disagree. Null is anonymous, which
 * reads every public round and enters none.
 */
export type ContestEntry =
  | {
      ok: true;
      contest: ContestConfig;
      /** This round's listing for the problem: its label, points and throttle. */
      problemEntry: ContestProblemConfig;
    }
  | { ok: false; reason: "contest-mismatch" | "not-entered" };

export function contestEntryFor(
  contestSlug: string,
  problemSlug: string,
  user: Pick<ResolvedUser, "handle" | "groups"> | null,
  now = new Date(),
): ContestEntry {
  const view = contestFor(contestSlug, viewerFor(user));
  const contest = view?.gate.visible ? view.config : undefined;

  // `find` rather than `some`: the entry is also where the round states what it
  // wants this problem's throttle and point value to be, and having located it
  // to answer "does this contest contain the problem" there is no reason to
  // look twice.
  const problemEntry = contest?.problems.find(
    (candidate) => candidate.slug === problemSlug,
  );

  if (!contest || !problemEntry || !isContestOpen(contest, now)) {
    return { ok: false, reason: "contest-mismatch" };
  }

  if (!user || !canEnterContest(contest, user)) {
    return { ok: false, reason: "not-entered" };
  }

  return { ok: true, contest, problemEntry };
}

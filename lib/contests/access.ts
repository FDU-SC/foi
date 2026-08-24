import { normalizeHandle, type ResolvedUser } from "@/lib/accounts/types";
import { inAudience, type Audience } from "@/lib/auth/audience";
import type { Viewer } from "@/lib/auth/viewer";
import { allContests, contestBySlug } from "./registry";
import { contestPhase, type ContestConfig } from "./types";

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
 *
 * Note what is *not* gated here. An unstarted contest is announced — its
 * title, its schedule and its format are how people know to turn up. What it
 * withholds is its problem set, which is a separate question with a separate
 * answer below, because those two leak different things.
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
 * `contestBySlug` never filtered on the audience, so before this existed a
 * contest kept off the index page was still readable by anyone who knew its
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
 * `participants` used to decide only who appeared on the board, so any account
 * could attribute submissions to a closed contest and occupy its judges with
 * them — the entries simply never showed up in the standings. Asking the
 * question on the submission path is what makes the field mean what it says.
 *
 * Here rather than in `./queries`, where it was written. Everything else in
 * that module reaches the database, so importing it to ask this — a question
 * about a config object and a group list, with no row behind it — opened a
 * connection pool as a side effect, and `eligibility.test.ts` needed a
 * `DATABASE_URL` to test a pure function. Being the second contest gate is the
 * better reason: `contestFor` says who may read the round, this says who may
 * compete in it, and a reader looking for one will want the other.
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
 * Two halves, and for a while they lived in different places. The clock half
 * was here; the override half was spelled out on the contest page and again
 * on the standings page, because both draw the problem set and both have to
 * let a proofreader in early. Nothing downstream re-checks — the labels and
 * point values go straight into the HTML — so a third page copying one half
 * of the rule would publish the shape of an unstarted round. That is the
 * failure `lib/submissions/access.ts` opens on, one page earlier.
 *
 * The override is `problem.viewAll` and not `contest.viewAll`: what is
 * withheld here is problems, and whoever may read an unopened statement may
 * certainly read its label and what it is worth.
 */
export function isContestProblemSetVisibleTo(
  contest: Pick<ContestConfig, "startsAt" | "endsAt">,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return (
    contestPhase(contest, now) !== "upcoming" || viewer.can("problem.viewAll")
  );
}

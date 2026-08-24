import { inAudience, type Audience } from "@/lib/auth/audience";
import type { Viewer } from "@/lib/auth/viewer";
import { allContests, contestBySlug } from "./registry";
import { contestPhase, type ContestConfig } from "./types";

/**
 * How anything that renders to a person obtains a contest.
 *
 * Same shape and same reasoning as `lib/problems/access.ts`: the gate sits at
 * the point of retrieval, so there is no way to ask for a contest without
 * saying who is asking, and no page has to remember a second filtering step.
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
 * `isContestProblemSetVisible` answers separately.
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
 * Whether a contest's problem set may be shown.
 *
 * Separate from whether the contest itself may be shown, because the leak is
 * different: the problem set gives away the shape of the round — how many
 * problems, what they are called, what they are worth — without opening a
 * single statement. So an upcoming contest has a public page and a withheld
 * problem list.
 */
export function isContestProblemSetVisible(
  contest: Pick<ContestConfig, "startsAt" | "endsAt">,
  now = new Date(),
): boolean {
  return contestPhase(contest, now) !== "upcoming";
}

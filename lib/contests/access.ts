import { denied, type Denial } from "@/lib/authz/adapters";
import { allows, authorize } from "@/lib/authz/engine";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { contestProblemRef } from "./refs";
import { allContests, contestBySlug } from "./registry";
import type { ContestConfig } from "./types";

/** The policy that reads `visibleTo`. Any other route in is a preview. */
const AUDIENCE = "builtin:contest-audience";

export interface ContestView {
  config: ContestConfig;

  /** Reached through some policy other than the audience one. */
  preview: boolean;
}

function viewOf(
  config: ContestConfig,
  viewer: Viewer,
  now: Date,
): ContestView | undefined {
  const decision = authorize("contest.read", config, viewer, { now });
  if (!decision.allow) return undefined;

  return { config, preview: decision.via !== AUDIENCE };
}

export function contestsFor(viewer: Viewer, now = new Date()): ContestView[] {
  return allContests().flatMap((config) => viewOf(config, viewer, now) ?? []);
}

export function contestFor(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): ContestView | undefined {
  const config = contestBySlug(slug);
  return config ? viewOf(config, viewer, now) : undefined;
}

export function canEnterContest(
  contest: ContestConfig,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return allows("contest.enter", contest, viewer, { now });
}

export function isContestProblemSetVisibleTo(
  contest: ContestConfig,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return allows("contest.readProblemSet", contest, viewer, { now });
}

export type ContestEntry =
  | { ok: true; ref: ContestProblemRef }
  | { ok: false; denial: Denial };

/**
 * Whether this viewer may compete on this problem, as part of the contest that
 * carries it, right now.
 *
 * A contest that does not exist, or does not hold this problem, is refused the
 * same way one the viewer cannot compete in is: naming a contest never reveals
 * anything about it.
 */
export function contestEntryFor(
  contestSlug: string,
  problemSlug: string,
  viewer: Viewer,
  now = new Date(),
): ContestEntry {
  const ref = contestProblemRef(contestSlug, problemSlug);
  if (!ref) {
    return {
      ok: false,
      denial: denied({
        code: "contest-mismatch",
        message: "这道题不属于这场比赛",
      }),
    };
  }

  const decision = authorize("contest.enter", ref.contest, viewer, { now });
  if (!decision.allow) return { ok: false, denial: decision };

  return { ok: true, ref };
}

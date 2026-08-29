import { denied, type Denial } from "@/lib/authz/adapters";
import { allows, authorize } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { allContests, contestBySlug } from "./registry";
import type { ContestConfig, ContestProblemConfig } from "./types";

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
  | {
      ok: true;
      contest: ContestConfig;
      problemEntry: ContestProblemConfig;
    }
  | { ok: false; denial: Denial };

/**
 * Whether the contest a client named can carry this problem for this viewer
 * right now — the question behind every submission's contest attribution.
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
  const mismatch = denied({
    code: "contest-mismatch",
    message: "这道题不属于这场比赛，或这场比赛现在不收题",
  });

  const contest = contestBySlug(contestSlug);
  if (!contest) return { ok: false, denial: mismatch };

  const problemEntry = contest.problems.find(
    (candidate) => candidate.slug === problemSlug,
  );
  if (!problemEntry) return { ok: false, denial: mismatch };

  const decision = authorize("contest.enter", contest, viewer, { now });
  if (!decision.allow) return { ok: false, denial: decision };

  return { ok: true, contest, problemEntry };
}

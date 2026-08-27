import type { ResolvedUser } from "@/lib/accounts/types";
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

export type ContestVisibility =
  | { visible: true }
  | { visible: false; reason: "audience"; audience: Audience };

export interface ContestView {
  config: ContestConfig;
  gate: ContestVisibility;
}

export function contestVisibility(
  contest: ContestConfig,
  viewer: Viewer,
): ContestVisibility {
  return inAudience(contest.visibleTo, viewer)
    ? { visible: true }
    : { visible: false, reason: "audience", audience: contest.visibleTo };
}

export function contestsFor(viewer: Viewer): ContestView[] {
  const override = viewer.can("contest.viewAll");
  return allContests()
    .map((config) => ({ config, gate: contestVisibility(config, viewer) }))
    .filter((entry) => override || entry.gate.visible);
}

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

export function canEnterContest(
  contest: ContestConfig,
  user: Pick<ResolvedUser, "uid" | "groups">,
): boolean {
  switch (contest.participants.mode) {
    case "open":
      return true;
    case "list":
      return contest.participants.uids.includes(user.uid);
    case "group":
      return user.groups.includes(contest.participants.group);
  }
}

export function isContestProblemSetVisibleTo(
  contest: ContestClock,
  viewer: Viewer,
  now = new Date(),
): boolean {
  return hasContestStarted(contest, now) || viewer.can("problem.viewAll");
}

export type ContestEntry =
  | {
      ok: true;
      contest: ContestConfig;

      problemEntry: ContestProblemConfig;
    }
  | { ok: false; reason: "contest-mismatch" | "not-entered" };

export function contestEntryFor(
  contestSlug: string,
  problemSlug: string,
  user: Pick<ResolvedUser, "uid" | "groups"> | null,
  now = new Date(),
): ContestEntry {
  const config = contestBySlug(contestSlug);
  if (!config) return { ok: false, reason: "contest-mismatch" };

  if (!inAudience(config.visibleTo, viewerFor(user))) {
    return { ok: false, reason: "contest-mismatch" };
  }

  const problemEntry = config.problems.find(
    (candidate) => candidate.slug === problemSlug,
  );

  if (!problemEntry || !isContestOpen(config, now)) {
    return { ok: false, reason: "contest-mismatch" };
  }

  if (!user || !canEnterContest(config, user)) {
    return { ok: false, reason: "not-entered" };
  }

  return { ok: true, contest: config, problemEntry };
}

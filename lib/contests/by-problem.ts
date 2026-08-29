import { allContests } from "./registry";
import { hasContestStarted, type ContestConfig } from "./types";

/**
 * The reverse index from a problem to the contests that use it, plus the
 * embargo that index implies.
 *
 * It sits apart from `access.ts` because the policy engine reads it while
 * evaluating problem visibility, and must not depend on the enforcement points
 * built on top of that engine.
 */

function buildIndex(): Map<string, ContestConfig[]> {
  const index = new Map<string, ContestConfig[]>();

  for (const contest of allContests()) {
    for (const entry of contest.problems) {
      const contests = index.get(entry.slug);
      if (contests) contests.push(contest);
      else index.set(entry.slug, [contest]);
    }
  }

  return index;
}

const contestsByProblem = buildIndex();

export function contestsUsing(slug: string): ContestConfig[] {
  return contestsByProblem.get(slug) ?? [];
}

export interface Embargo {
  contestSlug: string;
  opensAt: Date;
}

/**
 * A problem held back until the contest that will use it starts. Once any
 * referencing contest has started the hold is over, even if others have not.
 * Problems no contest references are never embargoed.
 */
export function embargoOf(slug: string, now: Date): Embargo | null {
  let earliest: Embargo | null = null;

  for (const contest of contestsUsing(slug)) {
    if (hasContestStarted(contest, now)) return null;

    if (!earliest || contest.startsAt < earliest.opensAt) {
      earliest = { contestSlug: contest.slug, opensAt: contest.startsAt };
    }
  }

  return earliest;
}

import type { ContestProblemRef } from "@/lib/authz/resources";
import { problemBySlug } from "@/lib/problems/registry";
import { allContests, contestBySlug } from "./registry";
import type { ContestConfig } from "./types";

/**
 * Every way a problem can be reached, which is to say every entry in every
 * contest's problem set paired with the problem it names.
 *
 * It sits apart from `access.ts` because the policy engine reads it while
 * evaluating problem visibility, and must not depend on the enforcement points
 * built on top of that engine.
 */

function refsIn(contest: ContestConfig): ContestProblemRef[] {
  return contest.problems.flatMap((entry) => {
    const problem = problemBySlug(entry.slug);
    return problem ? [{ contest, entry, problem }] : [];
  });
}

const allRefs: ContestProblemRef[] = allContests().flatMap(refsIn);

const byContest = new Map<string, Map<string, ContestProblemRef>>();
for (const ref of allRefs) {
  let inContest = byContest.get(ref.contest.slug);
  if (!inContest) {
    inContest = new Map();
    byContest.set(ref.contest.slug, inContest);
  }
  inContest.set(ref.problem.slug, ref);
}

export function contestProblemRefs(): ContestProblemRef[] {
  return allRefs;
}

export function contestProblemRef(
  contestSlug: string,
  problemSlug: string,
): ContestProblemRef | undefined {
  return byContest.get(contestSlug)?.get(problemSlug);
}

export function contestProblemRefsIn(contestSlug: string): ContestProblemRef[] {
  const contest = contestBySlug(contestSlug);
  return contest ? refsIn(contest) : [];
}

/** Problems no contest carries, and which therefore nobody can ever open. */
export function orphanedProblems(everySlug: readonly string[]): string[] {
  const carried = new Set(allRefs.map((ref) => ref.problem.slug));
  return everySlug.filter((slug) => !carried.has(slug));
}

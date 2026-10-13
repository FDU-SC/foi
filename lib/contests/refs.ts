import type { ContestProblemRef } from "@/lib/authz/resources";
import { libraryGeneration } from "@/lib/problems/library";
import { problemBySlug } from "@/lib/problems/registry";
import { allContests, contestBySlug, contestProblemsOf } from "./registry";
import type { ContestConfig } from "./types";

/**
 * Every way a problem can be reached, which is to say every entry in every
 * contest's problem set paired with the problem it names.
 *
 * It sits apart from `access.ts` because the policy engine reads it while
 * evaluating problem visibility, and must not depend on the enforcement points
 * built on top of that engine.
 *
 * The index is rebuilt when the set of authored problems changes. It has to be,
 * because this is built at module scope while the library is loaded at runtime:
 * a memo keyed on the library's generation is what keeps a newly published
 * problem from being invisible to the pair every gate is asked about.
 */

interface RefIndex {
  generation: number;
  all: ContestProblemRef[];
  byContest: Map<string, Map<string, ContestProblemRef>>;
}

let cached: RefIndex | null = null;

function refsIn(contest: ContestConfig): ContestProblemRef[] {
  return contestProblemsOf(contest).flatMap((entry) => {
    const problem = problemBySlug(entry.slug);
    return problem ? [{ contest, entry, problem }] : [];
  });
}

function index(): RefIndex {
  const generation = libraryGeneration();
  if (cached?.generation === generation) return cached;

  const all = allContests().flatMap(refsIn);
  const byContest = new Map<string, Map<string, ContestProblemRef>>();

  for (const ref of all) {
    let inContest = byContest.get(ref.contest.slug);
    if (!inContest) {
      inContest = new Map();
      byContest.set(ref.contest.slug, inContest);
    }
    inContest.set(ref.problem.slug, ref);
  }

  return (cached = { generation, all, byContest });
}

export function contestProblemRefs(): ContestProblemRef[] {
  return index().all;
}

export function contestProblemRef(
  contestSlug: string,
  problemSlug: string,
): ContestProblemRef | undefined {
  return index().byContest.get(contestSlug)?.get(problemSlug);
}

export function contestProblemRefsIn(contestSlug: string): ContestProblemRef[] {
  const contest = contestBySlug(contestSlug);
  return contest ? refsIn(contest) : [];
}

/** Problems no contest carries, and which therefore nobody can ever open. */
export function orphanedProblems(everySlug: readonly string[]): string[] {
  const carried = new Set(index().all.map((ref) => ref.problem.slug));
  return everySlug.filter((slug) => !carried.has(slug));
}

import { asc, eq } from "drizzle-orm";
import { getContest } from "@/lib/contests/registry";
import {
  resolveContestProblems,
  resolveParticipants,
} from "@/lib/contests/queries";
import type { ContestConfig } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { getMember } from "@/lib/roster/registry";
import { cachedStandings } from "./cache";
import { getRuleset } from "./registry";
import type {
  AnyRuleset,
  ContestProblem,
  Participant,
  Standings,
  SubmissionRecord,
} from "./types";

export interface ContestStandings {
  contest: ContestConfig;
  problems: ContestProblem[];
  ruleset: AnyRuleset;
  standings: Standings<unknown>;
}

/**
 * The contest, its problem set and its roster all come from the registry now;
 * the database is queried only for the submissions. That removes three joins
 * and, more usefully, means the standings reflect the repository rather than
 * whatever a past administrator clicked.
 */
async function loadAndCompute(slug: string): Promise<ContestStandings | null> {
  const contest = getContest(slug);
  if (!contest) return null;

  const ruleset = getRuleset(contest.ruleset.id);
  if (!ruleset) {
    throw new Error(`未知的赛制 "${contest.ruleset.id}"`);
  }

  const problemRows = resolveContestProblems(contest);

  const submissionRows = await db
    .select({
      id: submissions.id,
      handle: submissions.handle,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      verdict: submissions.verdict,
      score: submissions.score,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(eq(submissions.contestSlug, contest.slug))
    .orderBy(asc(submissions.createdAt));

  const declared = resolveParticipants(contest);

  // A contest with `participants: { mode: "open" }` has no declared roster, so
  // anyone who submitted counts. This keeps casual contests usable with no
  // registration step, which is what the old empty-roster fallback did.
  const participants: Participant[] =
    declared === null
      ? deriveParticipants(submissionRows)
      : declared.map((member) => ({
          handle: member.handle,
          displayName: member.displayName,
          unofficial: false,
        }));

  const input = {
    config: contest.ruleset.config,
    contest: {
      slug: contest.slug,
      startsAt: contest.startsAt,
      endsAt: contest.endsAt,
      freezeAt: contest.freezeAt ?? null,
    },
    problems: problemRows satisfies ContestProblem[],
    participants,
    submissions: submissionRows satisfies SubmissionRecord[],
  };

  return {
    contest,
    problems: problemRows,
    ruleset,
    standings: ruleset.computeStandings(input),
  };
}

/**
 * Display names come from the roster where possible. A handle that is no
 * longer listed keeps its submissions on the board under the bare handle
 * rather than vanishing from a contest it took part in.
 */
function deriveParticipants(rows: { handle: string }[]): Participant[] {
  const seen = new Map<string, Participant>();
  for (const row of rows) {
    if (seen.has(row.handle)) continue;
    const member = getMember(row.handle);
    seen.set(row.handle, {
      handle: member?.handle ?? row.handle,
      displayName: member?.displayName ?? row.handle,
      unofficial: false,
    });
  }
  return [...seen.values()];
}

export function getContestStandings(
  slug: string,
): Promise<ContestStandings | null> {
  return cachedStandings(slug, () => loadAndCompute(slug));
}

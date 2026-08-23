import { asc, eq } from "drizzle-orm";
import { getContest } from "@/lib/contests/registry";
import {
  resolveContestProblems,
  resolveParticipants,
} from "@/lib/contests/queries";
import type { ContestConfig } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
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
      displayName: accounts.displayName,
    })
    .from(submissions)
    .innerJoin(accounts, eq(accounts.handle, submissions.handle))
    .where(eq(submissions.contestSlug, contest.slug))
    .orderBy(asc(submissions.createdAt));

  const declared = await resolveParticipants(contest);

  // A contest with `participants: { mode: "open" }` names no field, so anyone
  // who submitted counts. This keeps casual contests usable with no entry step
  // at all.
  const participants: Participant[] =
    declared === null
      ? deriveParticipants(submissionRows)
      : declared.map((entrant) => ({
          handle: entrant.handle,
          displayName: entrant.displayName,
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
 * An open contest has no declared entry list, so whoever submitted competes.
 * Their display name rode along on the join above, which is what keeps this a
 * pure function of the rows it was handed.
 */
function deriveParticipants(
  rows: { handle: string; displayName: string }[],
): Participant[] {
  const seen = new Map<string, Participant>();
  for (const row of rows) {
    if (seen.has(row.handle)) continue;
    seen.set(row.handle, {
      handle: row.handle,
      displayName: row.displayName,
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

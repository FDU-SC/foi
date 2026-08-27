import { asc, eq } from "drizzle-orm";
import { contestBySlug } from "@/lib/contests/registry";
import {
  resolveContestProblems,
  resolveParticipants,
} from "@/lib/contests/resolve";
import { contestPhase, type ContestConfig } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import type { Viewer } from "@/lib/permissions/viewer";
import { cachedStandings, standingsKey } from "./cache";
import { rulesetFor } from "./registry";
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

  freezeBypassed: boolean;
}

async function loadAndCompute(
  slug: string,
  ignoreFreeze: boolean,
): Promise<ContestStandings | null> {
  const contest = contestBySlug(slug);
  if (!contest) return null;

  const ruleset = rulesetFor(contest.ruleset.id);
  if (!ruleset) {
    throw new Error(`比赛 "${contest.slug}" 没有可用的赛制`);
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
      maxScore: submissions.maxScore,
      accepted: submissions.accepted,
      createdAt: submissions.createdAt,
      displayName: accounts.displayName,
    })
    .from(submissions)
    .innerJoin(accounts, eq(accounts.handle, submissions.handle))
    .where(eq(submissions.contestSlug, contest.slug))
    .orderBy(asc(submissions.createdAt));

  const declared = await resolveParticipants(contest);

  const participants: Participant[] =
    declared === null
      ? deriveParticipants(submissionRows)
      : declared.map((entrant) => ({
          handle: entrant.handle,
          displayName: entrant.displayName,
        }));

  const freezeAt = ignoreFreeze ? null : (contest.freezeAt ?? null);

  const input = {
    config: contest.ruleset.config,
    contest: {
      slug: contest.slug,
      startsAt: contest.startsAt,
      endsAt: contest.endsAt,
      freezeAt,
    },
    problems: problemRows satisfies ContestProblem[],
    participants,
    submissions: submissionRows satisfies SubmissionRecord[],
  };

  const wouldFreeze = contestPhase(contest) === "frozen";

  return {
    contest,
    problems: problemRows,
    ruleset,
    standings: ruleset.computeStandings(input),
    freezeBypassed: ignoreFreeze && wouldFreeze,
  };
}

function deriveParticipants(
  rows: { handle: string; displayName: string }[],
): Participant[] {
  const seen = new Map<string, Participant>();
  for (const row of rows) {
    if (seen.has(row.handle)) continue;
    seen.set(row.handle, {
      handle: row.handle,
      displayName: row.displayName,
    });
  }
  return [...seen.values()];
}

export function standingsFor(
  slug: string,
  viewer: Viewer,
): Promise<ContestStandings | null> {
  const ignoreFreeze = viewer.can("standings.viewFrozen");
  return cachedStandings(
    standingsKey(slug, ignoreFreeze ? "unfrozen" : "public"),
    () => loadAndCompute(slug, ignoreFreeze),
  );
}

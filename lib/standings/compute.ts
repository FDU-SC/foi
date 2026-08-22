import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contestParticipants,
  contestProblems,
  contests,
  problems,
  submissions,
  users,
} from "@/lib/db/schema";
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
  contest: typeof contests.$inferSelect;
  problems: ContestProblem[];
  ruleset: AnyRuleset;
  standings: Standings<unknown>;
}

async function loadAndCompute(
  contestId: string,
): Promise<ContestStandings | null> {
  const [contest] = await db
    .select()
    .from(contests)
    .where(eq(contests.id, contestId))
    .limit(1);
  if (!contest) return null;

  const ruleset = getRuleset(contest.rulesetId);
  if (!ruleset) {
    throw new Error(`未知的赛制 "${contest.rulesetId}"`);
  }

  const problemRows = await db
    .select({
      slug: contestProblems.problemSlug,
      label: contestProblems.label,
      points: contestProblems.points,
      config: contestProblems.config,
      title: problems.title,
      maxScore: problems.maxScore,
    })
    .from(contestProblems)
    .innerJoin(problems, eq(problems.slug, contestProblems.problemSlug))
    .where(eq(contestProblems.contestId, contestId))
    .orderBy(asc(contestProblems.order));

  const submissionRows = await db
    .select({
      id: submissions.id,
      userId: submissions.userId,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      verdict: submissions.verdict,
      score: submissions.score,
      createdAt: submissions.createdAt,
      handle: users.handle,
      displayName: users.displayName,
    })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.userId))
    .where(eq(submissions.contestId, contestId))
    .orderBy(asc(submissions.createdAt));

  const registered = await db
    .select({
      userId: contestParticipants.userId,
      unofficial: contestParticipants.unofficial,
      handle: users.handle,
      displayName: users.displayName,
    })
    .from(contestParticipants)
    .innerJoin(users, eq(users.id, contestParticipants.userId))
    .where(eq(contestParticipants.contestId, contestId));

  // Without an explicit roster, anyone who submitted counts as a participant.
  // This keeps casual contests usable without a registration step.
  const participants: Participant[] =
    registered.length > 0
      ? registered
      : dedupeParticipants(submissionRows);

  const input = {
    config: contest.rulesetConfig,
    contest: {
      id: contest.id,
      startsAt: contest.startsAt,
      endsAt: contest.endsAt,
      freezeAt: contest.freezeAt,
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

function dedupeParticipants(
  rows: { userId: string; handle: string; displayName: string }[],
): Participant[] {
  const seen = new Map<string, Participant>();
  for (const row of rows) {
    if (seen.has(row.userId)) continue;
    seen.set(row.userId, {
      userId: row.userId,
      handle: row.handle,
      displayName: row.displayName,
      unofficial: false,
    });
  }
  return [...seen.values()];
}

export function getContestStandings(
  contestId: string,
): Promise<ContestStandings | null> {
  return cachedStandings(contestId, () => loadAndCompute(contestId));
}

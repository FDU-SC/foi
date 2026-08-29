import { asc, eq } from "drizzle-orm";
import { contestBySlug } from "@/lib/contests/registry";
import {
  resolveContestProblems,
  resolveParticipants,
} from "@/lib/contests/resolve";
import {
  contestPhase,
  type ContestConfig,
  type LeaderboardConfig,
} from "@/lib/contests/types";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { cachedStandings, standingsKey } from "./cache";
import { renderersFor, rulesetFor } from "./registry";
import type {
  AnyRuleset,
  ComputedStandings,
  ContestProblem,
  Participant,
  RulesetRenderers,
  SubmissionRecord,
} from "./types";

export interface LeaderboardStandings {
  leaderboard: LeaderboardConfig;
  ruleset: AnyRuleset;
  renderers: RulesetRenderers;
  standings: ComputedStandings<unknown>;
}

export interface ContestStandings {
  contest: ContestConfig;
  problems: ContestProblem[];
  boards: LeaderboardStandings[];
  frozen: boolean;
}

async function loadAndCompute(
  slug: string,
  ignoreFreeze: boolean,
): Promise<ContestStandings | null> {
  const contest = contestBySlug(slug);
  if (!contest) return null;

  const problemRows = resolveContestProblems(contest);

  const submissionRows = await db
    .select({
      id: submissions.id,
      uid: submissions.uid,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      result: submissions.result,
      createdAt: submissions.createdAt,
      nickname: accounts.nickname,
    })
    .from(submissions)
    .innerJoin(accounts, eq(accounts.uid, submissions.uid))
    .where(eq(submissions.contestSlug, contest.slug))
    .orderBy(asc(submissions.createdAt));

  const declared = await resolveParticipants(contest);

  const participants: Participant[] =
    declared === null
      ? deriveParticipants(submissionRows)
      : declared.map((entrant) => ({
          uid: entrant.uid,
          nickname: entrant.nickname,
        }));

  const phase = contestPhase(contest);
  const isFrozen = phase === "frozen";
  const shouldFreeze = isFrozen && !ignoreFreeze && !!contest.freezeAt;

  // Mask results of post-freeze submissions so rulesets treat them as pending.
  const effectiveSubmissions: SubmissionRecord[] = shouldFreeze
    ? submissionRows.map((s) =>
        s.createdAt >= contest.freezeAt! ? { ...s, result: null } : s,
      )
    : submissionRows;

  const boards: LeaderboardStandings[] = contest.leaderboards.map((lb) => {
    const ruleset = rulesetFor(lb.ruleset.id);
    if (!ruleset) {
      throw new Error(
        `排行榜 "${lb.id}" 引用了不存在的赛制 "${lb.ruleset.id}"`,
      );
    }

    const standings = ruleset.compute({
      config: lb.ruleset.config,
      contest: {
        slug: contest.slug,
        startsAt: contest.startsAt,
        endsAt: contest.endsAt,
      },
      problems: problemRows,
      participants,
      submissions: effectiveSubmissions,
    });

    return {
      leaderboard: lb,
      ruleset,
      renderers: renderersFor(lb.ruleset.id),
      standings,
    };
  });

  return {
    contest,
    problems: problemRows,
    boards,
    frozen: isFrozen,
  };
}

function deriveParticipants(
  rows: { uid: number; nickname: string }[],
): Participant[] {
  const seen = new Map<number, Participant>();
  for (const row of rows) {
    if (seen.has(row.uid)) continue;
    seen.set(row.uid, {
      uid: row.uid,
      nickname: row.nickname,
    });
  }
  return [...seen.values()];
}

/**
 * Freeze is not a second computation — it is result masking, and which of the
 * two boards a viewer gets is one authorization question like any other.
 */
export function standingsFor(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): Promise<ContestStandings | null> {
  const contest = contestBySlug(slug);
  if (!contest) return Promise.resolve(null);

  if (!allows("standings.read", contest, viewer, { now })) {
    return Promise.resolve(null);
  }

  const ignoreFreeze = allows("standings.readUnfrozen", contest, viewer, {
    now,
  });

  return cachedStandings(
    standingsKey(slug, ignoreFreeze ? "unfrozen" : "public"),
    () => loadAndCompute(slug, ignoreFreeze),
  );
}

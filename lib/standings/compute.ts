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
import type { Viewer } from "@/lib/permissions/viewer";
import { cachedStandings, standingsKey } from "./cache";
import { rulesetFor } from "./registry";
import type {
  AnyRuleset,
  ComputedStandings,
  ContestProblem,
  Participant,
  SubmissionRecord,
} from "./types";

export interface LeaderboardStandings {
  leaderboard: LeaderboardConfig;
  ruleset: AnyRuleset;
  /** Full standings (all submissions, admin view). */
  full: ComputedStandings<unknown>;
  /** Public standings (pre-freeze submissions only). null when no freeze is active. */
  public: ComputedStandings<unknown> | null;
}

export interface ContestStandings {
  contest: ContestConfig;
  problems: ContestProblem[];
  boards: LeaderboardStandings[];
  frozen: boolean;
  freezeBypassed: boolean;
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

  const boards: LeaderboardStandings[] = contest.leaderboards.map((lb) => {
    const ruleset = rulesetFor(lb.ruleset.id);
    if (!ruleset) {
      throw new Error(
        `排行榜 "${lb.id}" 引用了不存在的赛制 "${lb.ruleset.id}"`,
      );
    }

    const baseInput = {
      config: lb.ruleset.config,
      contest: {
        slug: contest.slug,
        startsAt: contest.startsAt,
        endsAt: contest.endsAt,
        freezeAt: contest.freezeAt ?? null,
      },
      problems: problemRows,
      participants,
      submissions: submissionRows satisfies SubmissionRecord[],
    };

    const full = ruleset.compute(baseInput);

    let publicBoard: ComputedStandings<unknown> | null = null;
    if (shouldFreeze) {
      const preFreezeSubmissions = submissionRows.filter(
        (s) => s.createdAt < contest.freezeAt!,
      );
      publicBoard = ruleset.compute({
        ...baseInput,
        submissions: preFreezeSubmissions,
      });
    }

    return { leaderboard: lb, ruleset, full, public: publicBoard };
  });

  return {
    contest,
    problems: problemRows,
    boards,
    frozen: isFrozen,
    freezeBypassed: ignoreFreeze && isFrozen,
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

import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { isContestProblemSetVisibleTo } from "@/lib/contests/access";
import { catalogueBoardSections } from "@/lib/contests/catalogue";
import { contestBySlug } from "@/lib/contests/registry";
import {
  resolveContestProblems,
  resolveParticipants,
} from "@/lib/contests/resolve";
import {
  contestPhase,
  pairKey,
  type ContestConfig,
  type LeaderboardConfig,
} from "@/lib/contests/types";
import { db } from "@/lib/db";
import { accounts, submissions } from "@/lib/db/schema";
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

export interface CatalogueStandings {
  /** The sections counted for this viewer, after any narrowing. */
  sections: ContestConfig[];
  problems: ContestProblem[];
  board: LeaderboardStandings;
  frozen: boolean;
}

export interface CatalogueQuery {
  /** A `site.catalogueLeaderboards` id. Absent is the total. */
  board?: string;

  /** Some of the board's sections. Empty keeps them all. */
  sections?: readonly string[];

  /** Only submissions from this moment on count. */
  from?: Date;

  /** Only submissions before this moment count. */
  until?: Date;
}

/** What a board reads, once every access question has been asked. */
interface Scope {
  contests: ContestConfig[];

  /** Contests whose results after `freezeAt` this viewer may not see. */
  masked: ReadonlySet<string>;
  from?: Date;
  until?: Date;
}

interface Loaded {
  problems: ContestProblem[];
  participants: Participant[];
  submissions: SubmissionRecord[];
}

interface Row {
  id: string;
  uid: number;
  contestSlug: string;
  problemSlug: string;
  state: SubmissionRecord["state"];
  result: unknown;
  createdAt: Date;
  username: string;
  nickname: string;
  avatarUpdatedAt: Date | null;
}

async function load({ contests, masked, from, until }: Scope): Promise<Loaded> {
  const problems = contests.flatMap((contest) =>
    resolveContestProblems(contest).map((problem) => ({
      ...problem,
      key: pairKey(contest.slug, problem.slug),
      contestSlug: contest.slug,
    })),
  );
  if (contests.length === 0) return { problems, participants: [], submissions: [] };

  const rows: Row[] = await db
    .select({
      id: submissions.id,
      uid: submissions.uid,
      contestSlug: submissions.contestSlug,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      result: submissions.result,
      createdAt: submissions.createdAt,
      username: accounts.username,
      nickname: accounts.nickname,
      avatarUpdatedAt: accounts.avatarUpdatedAt,
    })
    .from(submissions)
    .innerJoin(accounts, eq(accounts.uid, submissions.uid))
    .where(and(
      inArray(submissions.contestSlug, contests.map(({ slug }) => slug)),
      from ? gte(submissions.createdAt, from) : undefined,
      until ? lt(submissions.createdAt, until) : undefined,
    ))
    .orderBy(asc(submissions.createdAt));

  // Mask results of post-freeze submissions so rulesets treat them as pending.
  const freezes = new Map(contests.flatMap((contest) =>
    masked.has(contest.slug) && contest.freezeAt ? [[contest.slug, contest.freezeAt] as const] : []));
  const records = rows.map((row): SubmissionRecord => {
    const freezeAt = freezes.get(row.contestSlug);
    return {
      id: row.id,
      uid: row.uid,
      contestSlug: row.contestSlug,
      problemKey: pairKey(row.contestSlug, row.problemSlug),
      state: row.state,
      result: freezeAt && row.createdAt >= freezeAt ? null : row.result,
      createdAt: row.createdAt,
    };
  });

  return { problems, participants: await participantsOf(contests, rows), submissions: records };
}

/** Each contest's roster, or whoever submitted to an open one; everyone once. */
async function participantsOf(contests: ContestConfig[], rows: Row[]): Promise<Participant[]> {
  const seen = new Map<number, Participant>();
  for (const contest of contests) {
    const entrants = (await resolveParticipants(contest))
      ?? rows.filter((row) => row.contestSlug === contest.slug);
    for (const { uid, username, nickname, avatarUpdatedAt } of entrants) {
      if (!seen.has(uid)) seen.set(uid, { uid, username, nickname, avatarUpdatedAt });
    }
  }
  return [...seen.values()];
}

function computeBoard(
  leaderboard: LeaderboardConfig,
  contests: ContestConfig[],
  { problems, participants, submissions: records }: Loaded,
): LeaderboardStandings {
  const ruleset = rulesetFor(leaderboard.ruleset.id);
  if (!ruleset) {
    throw new Error(
      `排行榜 "${leaderboard.id}" 引用了不存在的赛制 "${leaderboard.ruleset.id}"`,
    );
  }

  return {
    leaderboard,
    ruleset,
    renderers: renderersFor(leaderboard.ruleset.id),
    standings: ruleset.compute({
      config: leaderboard.ruleset.config,
      contests: contests.map(({ slug, startsAt, endsAt }) => ({ slug, startsAt, endsAt })),
      problems,
      participants,
      submissions: records,
    }),
  };
}

/**
 * Freeze is not a second computation — it is result masking, and which of the
 * two boards a viewer gets is one authorization question like any other.
 */
export function masks(contest: ContestConfig, viewer: Viewer, now: Date): boolean {
  return (
    contestPhase(contest, now) === "frozen" &&
    contest.freezeAt !== undefined &&
    !allows("standings.readUnfrozen", contest, viewer, { now })
  );
}

/** Every leaderboard one contest declares. */
export function standingsFor(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): Promise<ContestStandings | null> {
  const contest = contestBySlug(slug);
  if (!contest || !allows("standings.read", contest, viewer, { now })) {
    return Promise.resolve(null);
  }

  const masked = masks(contest, viewer, now);
  return cachedStandings(
    standingsKey(slug, masked ? "masked" : "clear"),
    [slug],
    async () => {
      const loaded = await load({ contests: [contest], masked: new Set(masked ? [slug] : []) });
      return {
        contest,
        problems: loaded.problems,
        boards: contest.leaderboards.map((leaderboard) => computeBoard(leaderboard, [contest], loaded)),
        frozen: contestPhase(contest, now) === "frozen",
      };
    },
  );
}

/**
 * A catalogue board: the main leaderboards of the sections it spans, computed
 * as one. The boot check holds those sections to one ruleset, so a board
 * narrowed to a single section reproduces that section's own main board.
 *
 * A section counts only where this viewer may read its standings and its
 * problem set, and is masked the way its own board would be.
 */
export function catalogueStandingsFor(
  { board, sections = [], from, until }: CatalogueQuery,
  viewer: Viewer,
  now = new Date(),
): Promise<CatalogueStandings | null> {
  const spanned = (catalogueBoardSections(board) ?? []).flatMap((slug) => contestBySlug(slug) ?? []);
  const primary = spanned[0]?.leaderboards[0];
  if (!primary) return Promise.resolve(null);

  const contests = spanned.filter((contest) =>
    (sections.length === 0 || sections.includes(contest.slug)) &&
    allows("standings.read", contest, viewer, { now }) &&
    isContestProblemSetVisibleTo(contest, viewer, now));
  const counted = contests.map(({ slug }) => slug);
  const masked = new Set(contests.filter((contest) => masks(contest, viewer, now)).map(({ slug }) => slug));

  return cachedStandings(
    standingsKey(`catalogue:${board ?? ""}`, [counted.join(","), [...masked].join(","), from?.getTime() ?? "", until?.getTime() ?? ""].join("|")),
    counted,
    async () => {
      const loaded = await load({ contests, masked, from, until });
      return {
        sections: contests,
        problems: loaded.problems,
        board: computeBoard(primary, contests, loaded),
        frozen: contests.some((contest) => contestPhase(contest, now) === "frozen"),
      };
    },
  );
}

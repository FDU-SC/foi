import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { allows } from "@/lib/authz/engine";
import { rowScope } from "@/lib/authz/filter";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { dayOf } from "@/lib/calendar-day";
import { isContestProblemSetVisibleTo } from "@/lib/contests/access";
import { catalogueSlugs, isCatalogue } from "@/lib/contests/catalogue";
import { allContests } from "@/lib/contests/registry";
import { pairKey, type ContestConfig } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { problemsFor } from "@/lib/problems/access";
import {
  historiesOf,
  interpretProgress,
  interpretsProgress,
  solvingSubmission,
} from "@/lib/problems/progress";
import type { ProblemProgress } from "@/lib/problems/views";
import { masks } from "@/lib/standings/compute";

export interface PairActivity {
  ref: ContestProblemRef;

  /** Null when this problem's content interprets no progress. */
  progress: ProblemProgress | null;

  /** When the submission that first made it solved was made. */
  solvedAt: Date | null;
  lastAt: Date;

  /** The `YYYY-MM-DD` of each submission, oldest first. */
  submittedOn: string[];
}

export interface SectionProgress {
  contest: ContestConfig;
  solved: number;

  /** Null when some problem here interprets no progress, so no total holds. */
  total: number | null;
}

export interface ProfileActivity {
  submissions: number;
  solved: number;
  lastAt: Date | null;

  /** Submissions per `YYYY-MM-DD` in the site's timezone. */
  days: Map<string, number>;

  /** Problems they submitted to, most recent first. */
  pairs: PairActivity[];

  /** Catalogued sections, in catalogue order. */
  sections: SectionProgress[];

  /** Other contests they submitted to, latest first. */
  contests: ContestConfig[];
}

function visibleContests(viewer: Viewer, now: Date): ContestConfig[] {
  return allContests().filter((contest) =>
    allows("standings.read", contest, viewer, { now }) &&
    isContestProblemSetVisibleTo(contest, viewer, now));
}

function readableColumn(viewer: Viewer, now: Date) {
  const scope = rowScope("submission.read", viewer, now);
  if (scope.kind === "all") return sql<boolean>`true`;
  if (scope.kind === "none") return sql<boolean>`false`;
  return sql<boolean>`coalesce(${scope.sql}, false)`;
}

/**
 * What leaderboards already tell this viewer, gathered for one person: only
 * contests whose standings and problem set the viewer may read, with results
 * after a freeze hidden unless the viewer may read that submission itself.
 */
export async function activityFor(
  uid: number,
  viewer: Viewer,
  now = new Date(),
): Promise<ProfileActivity> {
  const contests = visibleContests(viewer, now);
  const refs = contests.flatMap((contest) =>
    problemsFor(contest.slug, viewer, now).map(({ ref }) => ref));

  const rows = contests.length === 0 ? [] : await db
    .select({
      id: submissions.id,
      contestSlug: submissions.contestSlug,
      problemSlug: submissions.problemSlug,
      state: submissions.state,
      result: submissions.result,
      createdAt: submissions.createdAt,
      judgedAt: submissions.judgedAt,
      readable: readableColumn(viewer, now),
    })
    .from(submissions)
    .where(and(
      eq(submissions.uid, uid),
      inArray(submissions.contestSlug, contests.map(({ slug }) => slug)),
    ))
    .orderBy(asc(submissions.createdAt), asc(submissions.id));

  const freezes = new Map(contests.flatMap((contest) =>
    masks(contest, viewer, now) && contest.freezeAt ? [[contest.slug, contest.freezeAt] as const] : []));
  const history = rows.map(({ readable, ...row }) => {
    const freezeAt = freezes.get(row.contestSlug);
    return freezeAt && row.createdAt >= freezeAt && !readable ? { ...row, result: null } : row;
  });

  const histories = historiesOf(history);
  const progress = interpretProgress(refs, histories);

  const days = new Map<string, number>();
  const entered = new Set<string>();
  for (const row of history) {
    const day = dayOf(row.createdAt);
    days.set(day, (days.get(day) ?? 0) + 1);
    entered.add(row.contestSlug);
  }

  const pairs = refs
    .flatMap((ref): PairActivity[] => {
      const key = pairKey(ref.contest.slug, ref.problem.slug);
      const rows = histories.get(key);
      if (!rows) return [];
      const state = progress.get(key) ?? null;
      return [{
        ref,
        progress: state,
        solvedAt: state?.state === "solved" ? solvingSubmission(ref, rows)?.createdAt ?? null : null,
        lastAt: rows[rows.length - 1].createdAt,
        submittedOn: rows.map((row) => dayOf(row.createdAt)),
      }];
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());

  const visible = new Map(contests.map((contest) => [contest.slug, contest]));
  const sections = catalogueSlugs().flatMap((slug): SectionProgress[] => {
    const contest = visible.get(slug);
    const inSection = refs.filter((ref) => ref.contest.slug === slug);
    if (!contest || inSection.length === 0) return [];
    const solved = inSection.filter((ref) =>
      progress.get(pairKey(slug, ref.problem.slug))?.state === "solved").length;
    return [{
      contest,
      solved,
      total: inSection.every(interpretsProgress) ? inSection.length : null,
    }];
  });

  return {
    submissions: history.length,
    solved: pairs.filter((pair) => pair.progress?.state === "solved").length,
    lastAt: history.at(-1)?.createdAt ?? null,
    days,
    pairs,
    sections,
    contests: contests
      .filter((contest) => entered.has(contest.slug) && !isCatalogue(contest.slug))
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
  };
}

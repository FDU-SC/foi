import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contestProblems, contests, problems } from "@/lib/db/schema";
import type { ContestRow } from "@/lib/db/schema";

export type ContestPhase = "upcoming" | "running" | "ended";

export function contestPhase(contest: ContestRow, now = new Date()): ContestPhase {
  if (now < contest.startsAt) return "upcoming";
  if (now > contest.endsAt) return "ended";
  return "running";
}

export const PHASE_LABEL: Record<ContestPhase, string> = {
  upcoming: "未开始",
  running: "进行中",
  ended: "已结束",
};

export function listContests(): Promise<ContestRow[]> {
  return db
    .select()
    .from(contests)
    .where(eq(contests.visible, true))
    .orderBy(desc(contests.startsAt));
}

export async function getContestBySlug(
  slug: string,
): Promise<ContestRow | undefined> {
  const [row] = await db
    .select()
    .from(contests)
    .where(eq(contests.slug, slug))
    .limit(1);
  return row;
}

export async function getContestById(
  id: string,
): Promise<ContestRow | undefined> {
  const [row] = await db
    .select()
    .from(contests)
    .where(eq(contests.id, id))
    .limit(1);
  return row;
}

export async function contestHasProblem(
  contestId: string,
  problemSlug: string,
): Promise<boolean> {
  const [row] = await db
    .select({ slug: contestProblems.problemSlug })
    .from(contestProblems)
    .where(
      and(
        eq(contestProblems.contestId, contestId),
        eq(contestProblems.problemSlug, problemSlug),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export function getContestProblems(contestId: string) {
  return db
    .select({
      slug: contestProblems.problemSlug,
      label: contestProblems.label,
      points: contestProblems.points,
      title: problems.title,
      maxScore: problems.maxScore,
    })
    .from(contestProblems)
    .innerJoin(problems, eq(problems.slug, contestProblems.problemSlug))
    .where(eq(contestProblems.contestId, contestId))
    .orderBy(asc(contestProblems.order));
}

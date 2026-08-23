import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contests } from "@/lib/db/schema";
import { getProblem } from "@/lib/problems/registry";
import { getMember, membersWithTag } from "@/lib/roster/registry";
import type { RosterEntry } from "@/lib/roster/types";
import { listContests as listContestConfigs } from "./registry";
import type { ContestConfig } from "./types";

/**
 * Resolves the registry's declarative references into the shapes the
 * standings and the contest pages consume. Everything here is a pure function
 * of the registries — the only database contact in this module is the mirror
 * sync at the bottom.
 */

export interface ResolvedContestProblem {
  slug: string;
  label: string;
  title: string;
  /** Per-contest override, or null to use the problem's own maxScore. */
  points: number | null;
  maxScore: number;
  config: unknown;
}

/**
 * The registry rejects unknown slugs at load time, so a missing problem here
 * would mean the registry and the problem set drifted within one process —
 * skip rather than throw, since a standings page is better than a stack trace.
 */
export function resolveContestProblems(
  contest: ContestConfig,
): ResolvedContestProblem[] {
  return contest.problems.flatMap((entry) => {
    const problem = getProblem(entry.slug);
    if (!problem) return [];
    return [
      {
        slug: entry.slug,
        label: entry.label,
        title: problem.title,
        points: entry.points ?? null,
        maxScore: problem.maxScore,
        config: entry.config ?? null,
      },
    ];
  });
}

/**
 * Who competes, per the contest's entry rule.
 *
 * `open` returns null rather than a list: the caller derives the roster from
 * whoever submitted, which is what makes a casual contest work with no setup.
 */
export function resolveParticipants(
  contest: ContestConfig,
): RosterEntry[] | null {
  switch (contest.participants.mode) {
    case "open":
      return null;
    case "tag":
      return membersWithTag(contest.participants.tag);
    case "list":
      return contest.participants.handles.flatMap((handle) => {
        const member = getMember(handle);
        return member && !member.disabled ? [member] : [];
      });
  }
}

/**
 * Pushes the contest registry into its mirror table.
 *
 * Upsert only. A contest deleted from the repository keeps its row so that
 * submissions made during it stay attributable; `/admin` reports the orphan
 * rather than letting the sync detach history on its own.
 */
export async function syncContests(): Promise<{ synced: number }> {
  const all = listContestConfigs({ includeHidden: true });
  if (all.length === 0) return { synced: 0 };

  await db
    .insert(contests)
    .values(all.map((contest) => ({ slug: contest.slug, title: contest.title })))
    .onConflictDoUpdate({
      target: contests.slug,
      set: { title: sql`excluded.title`, syncedAt: new Date() },
    });

  return { synced: all.length };
}

/**
 * Upserts a single contest before a submission references it, mirroring
 * `ensureProblem`: a contest added during `next dev` would otherwise fail the
 * submissions foreign key until the next restart.
 */
export async function ensureContest(contest: ContestConfig): Promise<void> {
  await db
    .insert(contests)
    .values({ slug: contest.slug, title: contest.title })
    .onConflictDoUpdate({
      target: contests.slug,
      set: { title: sql`excluded.title`, syncedAt: new Date() },
    });
}

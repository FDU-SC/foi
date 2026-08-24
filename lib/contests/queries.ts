import { sql } from "drizzle-orm";
import { accountSnapshot } from "@/lib/accounts/cache";
import { normalizeHandle } from "@/lib/accounts/types";
import type { ResolvedUser } from "@/lib/accounts/types";
import { db } from "@/lib/db";
import { contests } from "@/lib/db/schema";
import { groupsFor } from "@/lib/enrollment/registry";
import { problemBySlug } from "@/lib/problems/registry";
import { allContests } from "./registry";
import type { ContestConfig } from "./types";

/**
 * Resolves the registry's declarative references into the shapes the
 * standings and the contest pages consume.
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
    // Raw is safe here because of an invariant the contest registry enforces
    // at load: a contest's audience never reaches past any of its problems'.
    // Anyone who got this far can therefore see every problem in the set, and
    // the only remaining question — has the round started — is asked once for
    // the whole set by the two pages that render it.
    const problem = problemBySlug(entry.slug);
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

export interface ResolvedParticipant {
  handle: string;
  displayName: string;
}

/**
 * Who competes, per the contest's entry rule.
 *
 * `open` returns null rather than a list: the caller derives the field from
 * whoever submitted, which is what makes a casual contest work with no setup.
 *
 * The other two now read accounts rather than a compiled roster, because that
 * is where people are. `group` in particular has to run the cohort rules over
 * every address, so it goes through the snapshot in `lib/accounts/cache.ts`
 * rather than issuing a query per contest view. A few seconds of staleness
 * only ever means a just-registered competitor appears on the board one
 * refresh late; nothing here grants access.
 */
/**
 * Whether this person may enter this contest.
 *
 * `participants` used to decide only who appeared on the board, so any account
 * could attribute submissions to a closed contest and occupy its judges with
 * them — the entries simply never showed up in the standings. Asking the
 * question on the submission path is what makes the field mean what it says.
 *
 * Cheap on purpose: `groups` is already resolved on the user, and a `list` is a
 * handful of handles, so this costs nothing and needs no snapshot.
 */
export function canEnterContest(
  contest: ContestConfig,
  user: Pick<ResolvedUser, "handle" | "groups">,
): boolean {
  switch (contest.participants.mode) {
    case "open":
      return true;
    case "list": {
      const handle = normalizeHandle(user.handle);
      return contest.participants.handles.some(
        (entry) => normalizeHandle(entry) === handle,
      );
    }
    case "group":
      return user.groups.includes(contest.participants.group);
  }
}

export async function resolveParticipants(
  contest: ContestConfig,
): Promise<ResolvedParticipant[] | null> {
  if (contest.participants.mode === "open") return null;

  const accounts = await accountSnapshot();

  if (contest.participants.mode === "list") {
    return contest.participants.handles.flatMap((handle) => {
      const account = accounts.get(handle.toLowerCase());
      return account && account.status === "active"
        ? [{ handle: account.handle, displayName: account.displayName }]
        : [];
    });
  }

  const wanted = contest.participants.group;
  const matched: ResolvedParticipant[] = [];
  for (const account of accounts.values()) {
    if (account.status !== "active") continue;
    if (!groupsFor(account.handle, account.email).includes(wanted)) continue;
    matched.push({ handle: account.handle, displayName: account.displayName });
  }

  return matched.sort((a, b) => a.handle.localeCompare(b.handle));
}

/**
 * Pushes the contest registry into its mirror table.
 *
 * Upsert only. A contest deleted from the repository keeps its row so that
 * submissions made during it stay attributable; `/admin` reports the orphan
 * rather than letting the sync detach history on its own.
 */
export async function syncContests(): Promise<{ synced: number }> {
  const all = allContests();
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

import { accountSnapshot } from "@/lib/accounts/cache";
import { groupsFor } from "@/lib/enrollment/registry";
import { problemBySlug } from "@/lib/problems/registry";
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
 * The other two read accounts, because that is where people are. `group` in
 * particular has to run the cohort rules over every address, so it goes
 * through the snapshot in `lib/accounts/cache.ts` rather than issuing a query
 * per contest view. A few seconds of staleness
 * only ever means a just-registered competitor appears on the board one
 * refresh late; nothing here grants access.
 *
 * Whether a given person is *entitled* to enter is not asked here — that is
 * `canEnterContest` in `./access`, next to the other contest gate.
 */
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
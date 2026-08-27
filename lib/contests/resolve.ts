import { accountSnapshot } from "@/lib/accounts/cache";
import { groupsFor } from "@/lib/enrollment/registry";
import { problemBySlug } from "@/lib/problems/registry";
import type { ContestConfig } from "./types";

export interface ResolvedContestProblem {
  slug: string;
  label: string;
  title: string;

  points: number | null;
  maxScore: number;
  config: unknown;
}

export function resolveContestProblems(
  contest: ContestConfig,
): ResolvedContestProblem[] {
  return contest.problems.flatMap((entry) => {

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

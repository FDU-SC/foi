import { accountSnapshot } from "@/lib/accounts/cache";
import { groupsFor } from "@/lib/enrollment/registry";
import { problemBySlug } from "@/lib/problems/registry";
import { matchesParticipants, type ContestConfig } from "./types";

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
  uid: number;
  nickname: string;
}

/**
 * The roster: who the contest names as a competitor. An open contest has no
 * roster to resolve — its standings are derived from whoever submitted.
 *
 * Being on the roster is not permission to compete; that is `contest.enter`.
 */
export async function resolveParticipants(
  contest: ContestConfig,
): Promise<ResolvedParticipant[] | null> {
  const { participants } = contest;
  if (participants.mode === "open") return null;

  const accounts = await accountSnapshot();

  const matched: ResolvedParticipant[] = [];
  for (const account of accounts.values()) {
    if (account.status !== "active") continue;

    const named = matchesParticipants(participants, {
      uid: account.uid,
      groups:
        participants.mode === "group"
          ? groupsFor(account.uid, account.email)
          : [],
    });
    if (!named) continue;

    matched.push({ uid: account.uid, nickname: account.nickname });
  }

  return matched.sort((a, b) => a.uid - b.uid);
}

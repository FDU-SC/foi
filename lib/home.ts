import type { Viewer } from "@/lib/authz/viewer";
import { isCatalogue } from "@/lib/contests/catalogue";
import { contestPhase, type ContestConfig } from "@/lib/contests/types";
import { problemFor } from "@/lib/problems/access";
import type { SubmissionListItem } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";

export function homeSubmissions(viewer: Viewer) {
  return viewer.uid === null
    ? Promise.resolve([])
    : submissionsFor(viewer, { uid: viewer.uid, limit: 50 });
}

export function recentPractice(
  rows: SubmissionListItem[],
  viewer: Viewer,
  now = new Date(),
) {
  const seen = new Set<string>();
  return rows
    .flatMap((row) => {
      const key = `${row.contestSlug}/${row.problemSlug}`;
      if (seen.has(key) || !isCatalogue(row.contestSlug)) return [];
      seen.add(key);
      const view = problemFor(row.contestSlug, row.problemSlug, viewer, now);
      return view ? [{ row, ref: view.ref }] : [];
    })
    .slice(0, 3);
}

export function recentContests<T extends { config: ContestConfig }>(
  contests: T[],
  now = new Date(),
): T[] {
  const rank = (contest: ContestConfig) => {
    const phase = contestPhase(contest, now);
    return phase === "ended" ? 2 : phase === "upcoming" ? 1 : 0;
  };
  return contests
    .filter(({ config }) => !isCatalogue(config.slug))
    .toSorted((a, b) => {
      const group = rank(a.config) - rank(b.config);
      if (group) return group;
      const phase = rank(a.config);
      return phase === 1
        ? a.config.startsAt.getTime() - b.config.startsAt.getTime()
        : (a.config.endsAt.getTime() - b.config.endsAt.getTime()) *
            (phase === 2 ? -1 : 1);
    })
    .slice(0, 3);
}

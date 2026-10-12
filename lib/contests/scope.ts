import type { SearchParams } from "@/lib/query";
import { catalogueBoardFor, catalogueBoardSections } from "./catalogue";

/**
 * What a catalogue page is looking at: everything, one direction, or one
 * section. The problem list and the leaderboard share it, so a tab switch
 * keeps what the sidebar has selected.
 */
export type CatalogueScope = { domain: string } | { section: string } | null;

/** Minimum a sidebar entry needs; full contest configs satisfy this. */
export interface DirectionContest {
  slug: string;
  domain?: string | null;
}

export interface Direction<T extends DirectionContest = DirectionContest> {
  /** The `contest.domain` label; `null` gathers the contests without one. */
  heading: string | null;
  contests: T[];
}

/** Contests under their directions: headings in first-appearance order, unlabelled last. */
export function directionsOf<T extends DirectionContest>(contests: readonly T[]): Direction<T>[] {
  const byHeading = new Map<string | null, T[]>();
  for (const contest of contests) {
    const key = contest.domain ?? null;
    byHeading.set(key, [...(byHeading.get(key) ?? []), contest]);
  }

  const unlabelled = byHeading.get(null);
  byHeading.delete(null);
  return [
    ...[...byHeading].map(([heading, within]) => ({ heading, contests: within })),
    ...(unlabelled ? [{ heading: null as string | null, contests: unlabelled }] : []),
  ];
}

/** A direction is a scope of its own only when it gathers several contests; one would repeat it. */
export function gathers<T extends DirectionContest>(
  direction: Direction<T>,
): direction is Direction<T> & { heading: string } {
  return direction.heading !== null && direction.contests.length > 1;
}

/** What a leaderboard ranks: a catalogue board, or the total, narrowed to some sections. */
export interface BoardScope {
  board?: string;
  sections: string[];
}

/** Sections covering a whole board say nothing the board does not. */
function normalized({ board, sections }: BoardScope): BoardScope {
  const whole = board === undefined ? undefined : catalogueBoardSections(board);
  const covers = whole !== undefined && sections.length === whole.length && whole.every((slug) => sections.includes(slug));
  return { board, sections: covers ? [] : [...sections].sort() };
}

/** The leaderboard query parameters naming a board scope. */
export function boardScopeQuery({ board, sections }: BoardScope): SearchParams {
  return {
    ...(board ? { board } : {}),
    ...(sections.length > 0 ? { section: sections } : {}),
  };
}

export function sameBoardScope(a: BoardScope, b: BoardScope): boolean {
  const [left, right] = [normalized(a), normalized(b)];
  return left.board === right.board && left.sections.join() === right.sections.join();
}

/** The leaderboard scope ranking what a catalogue scope lists. */
export function boardScopeOf(scope: CatalogueScope, directions: readonly Direction[]): BoardScope {
  if (scope === null) return { sections: [] };
  if ("section" in scope) {
    return normalized({ board: catalogueBoardFor(scope.section)?.id, sections: [scope.section] });
  }

  const slugs = directions.find(({ heading }) => heading === scope.domain)?.contests.map(({ slug }) => slug) ?? [];
  const boards = new Set(slugs.map((slug) => catalogueBoardFor(slug)?.id));
  const [board] = boards;
  if (boards.size === 1 && board !== undefined) return normalized({ board, sections: slugs });

  // Split across boards: rank the direction's sections the total counts.
  const total = catalogueBoardSections() ?? [];
  return { sections: slugs.filter((slug) => total.includes(slug)).sort() };
}

/** The catalogue scope a leaderboard scope ranks, when it ranks exactly one. */
export function catalogueScopeOf(ranked: BoardScope, directions: readonly Direction[]): CatalogueScope | undefined {
  const candidates: CatalogueScope[] = [
    null,
    ...directions.filter(gathers).map(({ heading }) => ({ domain: heading })),
    ...directions.flatMap(({ contests }) => contests.map(({ slug }) => ({ section: slug }))),
  ];
  return candidates.find((scope) => sameBoardScope(boardScopeOf(scope, directions), ranked));
}

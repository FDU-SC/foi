import type { ProblemView } from "./access";
import { collectFacets, facetCounts, matchesFacets, type FacetSelection, type FacetSubject } from "./facets";
import type { ProblemConfig } from "./types";
import type { ProblemProgress } from "./views";
import { pairKey } from "@/lib/contests/types";
import { paginate } from "@/lib/paging";
import { readAll, readOne, type SearchParams } from "@/lib/query";

/** Facet keys cannot shadow the built-in query parameters. */
export const SELECTION_PARAMS = { search: "q", status: "status", sort: "sort", facet: "f." } as const;
const STATUSES = ["solved", "attempted", "untouched"] as const;

export type ProblemSort = "listed" | "newest" | "score";
export const DEFAULT_PROBLEM_SORT: ProblemSort = "listed";

/** Progress keyed by `pairKey`, since one list may span contests. */
type Progress = ReadonlyMap<string, ProblemProgress> | null;

export function progressKey({ ref }: ProblemView): string {
  return pairKey(ref.contest.slug, ref.problem.slug);
}

/** Progress covers the readable problem set, before any filtering. */
export function summarizeProgress(problems: readonly ProblemView[], progress: Progress) {
  const complete = progress !== null && problems.every((view) => progress.has(progressKey(view)));
  return {
    complete,
    showProgress: progress !== null && progress.size > 0,
    solved: complete
      ? problems.filter((view) => progress.get(progressKey(view))?.state === "solved").length
      : null,
  };
}

/** Newest is the tail of one contest's list; problems from several share no such order. */
export function problemSorts(problems: readonly ProblemView[]): ProblemSort[] {
  const contests = new Set(problems.map(({ ref }) => ref.contest.slug));
  return contests.size > 1 ? ["listed", "score"] : ["listed", "newest", "score"];
}

function pick<T extends string>(asked: string | undefined, from: readonly T[]): T | undefined {
  return from.find((one) => one === asked);
}

function matchesQuery(config: ProblemConfig, query: string): boolean {
  if (query.length === 0) return true;
  return (
    config.title.toLowerCase().includes(query) || config.slug.includes(query)
  );
}

function matchesStatus(
  status: string | undefined,
  mine: ProblemProgress | undefined,
): boolean {
  if (status) return mine?.state === status;
  return true;
}

/** What its contest makes a problem worth, which the entry may override. */
function worth({ ref }: ProblemView): number {
  return ref.entry.points ?? ref.problem.maxScore;
}

function sorted(views: ProblemView[], sort: ProblemSort): ProblemView[] {
  if (sort === "score") return [...views].sort((a, b) => worth(b) - worth(a));
  if (sort === "newest") return views.toReversed();
  return views;
}

function subject({ ref }: ProblemView): FacetSubject {
  return { config: ref.problem, offered: ref.contest.facets };
}

/**
 * Select, count and page a readable problem list; performs no reads.
 *
 * The list may span contests. Each problem is filtered and badged by the
 * dimensions its own contest offers.
 */
export function selectProblems({ problems: catalogue, progress, query }: {
  problems: readonly ProblemView[];
  progress: Progress;
  query: SearchParams;
}) {
  const summary = summarizeProgress(catalogue, progress);
  const groups = collectFacets(catalogue.map(subject));
  const selection: FacetSelection = Object.fromEntries(
    groups.map((group) => [group.key, readAll(query, SELECTION_PARAMS.facet + group.key)]),
  );
  const searchValue = readOne(query, SELECTION_PARAMS.search) ?? "";
  const text = searchValue.trim().toLowerCase();
  const status = summary.complete ? pick(readOne(query, SELECTION_PARAMS.status), STATUSES) : undefined;
  const sorts = problemSorts(catalogue);
  const sort = pick(readOne(query, SELECTION_PARAMS.sort), sorts) ?? DEFAULT_PROBLEM_SORT;
  const mine = (view: ProblemView) => progress?.get(progressKey(view));
  const facetsMatch = ({ ref }: ProblemView) =>
    matchesFacets(ref.problem, ref.contest.facets, selection);

  // Each count applies every criterion except its own dimension.
  const beforeFacets = catalogue.filter((view) =>
    matchesQuery(view.ref.problem, text) && matchesStatus(status, mine(view)),
  );
  const beforeStatus = catalogue.filter((view) =>
    matchesQuery(view.ref.problem, text) && facetsMatch(view),
  );
  const counts = facetCounts(beforeFacets.map(subject), groups, selection);
  const matched = sorted(beforeFacets.filter(facetsMatch), sort);
  const statusCounts = new Map(STATUSES.map((value) => [value,
    beforeStatus.filter((view) => matchesStatus(value, mine(view))).length,
  ]));
  const narrowed = matched.length !== catalogue.length;
  const { items, page, pages } = paginate(matched, query);

  return {
    problems: items, matched: matched.length, page, pages,
    groups, selection, counts, status, sort, sorts, statusCounts, summary,
    searchValue, narrowed,
    filtered: narrowed || text.length > 0 || sort !== DEFAULT_PROBLEM_SORT,
    params: summary.complete ? query : Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== SELECTION_PARAMS.status),
    ),
  };
}

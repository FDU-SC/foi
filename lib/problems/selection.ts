import type { ProblemView } from "./access";
import { collectFacets, facetCounts, matchesFacets, type FacetSelection } from "./facets";
import type { ProblemConfig } from "./types";
import type { ProblemProgress } from "./views";
import { readAll, readOne, type SearchParams } from "@/lib/query";

/** Facet keys cannot shadow the built-in query parameters. */
export const SELECTION_PARAMS = { search: "q", status: "status", sort: "sort", facet: "f." } as const;
const STATUSES = [{ value: "solved" }, { value: "attempted" }, { value: "untouched" }] as const;
const SORTS = [{ value: "newest" }, { value: "listed" }, { value: "score" }] as const;
export const DEFAULT_PROBLEM_SORT = "newest";

type Progress = ReadonlyMap<string, ProblemProgress> | null;

/** Progress covers the readable problem set, before any filtering. */
export function summarizeProgress(problems: readonly ProblemView[], progress: Progress) {
  const complete = progress !== null && problems.every(({ ref }) => progress.has(ref.problem.slug));
  return {
    complete,
    showProgress: progress !== null && progress.size > 0,
    solved: complete
      ? problems.filter(({ ref }) => progress.get(ref.problem.slug)?.state === "solved").length
      : null,
  };
}

function pick(
  asked: string | undefined,
  from: readonly { value: string }[],
): string | undefined {
  return from.some((one) => one.value === asked) ? asked : undefined;
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

/** What this section is worth a problem, which the contest may override. */
function worth({ ref }: ProblemView): number {
  return ref.entry.points ?? ref.problem.maxScore;
}

function sorted(views: ProblemView[], sort: string): ProblemView[] {
  if (sort === "score") return [...views].sort((a, b) => worth(b) - worth(a));
  if (sort === "newest") return views.toReversed();
  return views;
}

/** Select and count against one readable contest problem set; performs no reads. */
export function selectProblems({ problems: catalogue, offered, progress, query }: {
  problems: readonly ProblemView[];
  offered: readonly string[];
  progress: Progress;
  query: SearchParams;
}) {
  const summary = summarizeProgress(catalogue, progress);
  const groups = collectFacets(catalogue.map(({ ref }) => ref.problem), offered);
  const selection: FacetSelection = Object.fromEntries(
    groups.map((group) => [group.key, readAll(query, SELECTION_PARAMS.facet + group.key)]),
  );
  const searchValue = readOne(query, SELECTION_PARAMS.search) ?? "";
  const text = searchValue.trim().toLowerCase();
  const status = summary.complete ? pick(readOne(query, SELECTION_PARAMS.status), STATUSES) : undefined;
  const sort = pick(readOne(query, SELECTION_PARAMS.sort), SORTS) ?? DEFAULT_PROBLEM_SORT;

  // Each count applies every criterion except its own dimension.
  const beforeFacets = catalogue.filter(({ ref }) =>
    matchesQuery(ref.problem, text) && matchesStatus(status, progress?.get(ref.problem.slug)),
  );
  const beforeStatus = catalogue.filter(({ ref }) =>
    matchesQuery(ref.problem, text) && matchesFacets(ref.problem, offered, selection),
  );
  const counts = facetCounts(beforeFacets.map(({ ref }) => ref.problem), offered, groups, selection);
  const problems = sorted(beforeFacets.filter(({ ref }) => matchesFacets(ref.problem, offered, selection)), sort);
  const statusCounts = new Map(STATUSES.map(({ value }) => [value,
    beforeStatus.filter(({ ref }) => matchesStatus(value, progress?.get(ref.problem.slug))).length,
  ]));
  const narrowed = problems.length !== catalogue.length;

  return {
    problems, groups, selection, counts, status, sort, statusCounts, summary,
    searchValue, narrowed,
    filtered: narrowed || text.length > 0 || sort !== DEFAULT_PROBLEM_SORT,
    params: summary.complete ? query : Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== SELECTION_PARAMS.status),
    ),
  };
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { Badge } from "@/components/ui/badge";
import { FilterBar, type FilterRow } from "@/components/ui/filter-bar";
import { TableFrame } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { contestFor } from "@/lib/contests/access";
import { catalogueContests } from "@/lib/contests/registry";
import {
  catalogueHref,
  catalogueSlugs,
  contestHref,
  isCatalogue,
  problemHref,
} from "@/lib/contests/catalogue";
import {
  directionsOf,
  gathers,
} from "@/lib/contests/scope";
import {
  pairKey,
  type ContestConfig,
} from "@/lib/contests/types";
import { problemsFor, type ProblemView } from "@/lib/problems/access";
import { progressFor } from "@/lib/problems/progress";
import {
  DEFAULT_PROBLEM_SORT,
  SELECTION_PARAMS,
  progressKey,
  selectProblems,
  type ProblemSort,
} from "@/lib/problems/selection";
import type { ProblemProgress } from "@/lib/problems/views";
import { queryString, readOne, without, type SearchParams } from "@/lib/query";

interface Props {
  /** Absent on `/problems`, where every list is shown at once. */
  params?: Promise<{ section?: string }>;
  searchParams: Promise<SearchParams>;
}

const { search: SEARCH, status: STATUS, sort: SORT, facet: FACET } = SELECTION_PARAMS;

/** Selects a direction on `/problems`; its value is the `contest.domain` label. */
const DOMAIN = "domain";

const STATE_LABEL: Record<ProblemProgress["state"], string> = {
  solved: "已通过",
  attempted: "尝试过",
  untouched: "未尝试",
};

const STATUSES = (Object.keys(STATE_LABEL) as ProblemProgress["state"][])
  .map((value) => ({ value, label: STATE_LABEL[value] }));

const SORT_LABEL: Record<ProblemSort, string> = {
  listed: "题单序",
  newest: "最新",
  score: "分值",
};

/** One catalogued contest as a list: the gate it passed and what it holds. */
interface List {
  contest: ContestConfig;
  preview: boolean;
  problems: ProblemView[];
}

/** The catalogued contest a URL names, refused the way a missing page is. */
async function sectionOf(params: Props["params"]): Promise<string | undefined> {
  const section = (await params)?.section;
  if (section !== undefined && !isCatalogue(section)) notFound();
  return section;
}

export async function problemSetMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const section = (await params)?.section;
  if (section !== undefined) {
    const view = isCatalogue(section) ? contestFor(section, await getViewer()) : undefined;
    return { title: view?.config.title ?? "题库" };
  }
  const domain = readOne(await searchParams, DOMAIN);
  const known = catalogueContests().some((contest) => contest.domain === domain);
  return { title: known ? domain : "题库" };
}

/**
 * The catalogue problem panel body. Title and tabs live in the shared shell;
 * this is the filters, table and pagination under them.
 */
export async function ProblemSetView({ params, searchParams }: Props) {
  const [section, query] = await Promise.all([sectionOf(params), searchParams]);
  const viewer = await getViewer();

  const lists: List[] = catalogueSlugs().flatMap((slug) => {
    const view = contestFor(slug, viewer);
    return view ? [{ contest: view.config, preview: view.preview, problems: problemsFor(slug, viewer) }] : [];
  });
  const selected = section === undefined ? undefined : lists.find(({ contest }) => contest.slug === section);
  if (section !== undefined && !selected) notFound();

  const progress = viewer.authenticated
    ? await progressFor(lists.map(({ contest }) => contest.slug), viewer)
    : null;

  const directions = directionsOf(lists.map(({ contest }) => contest));
  const listOf = new Map(lists.map((list) => [list.contest.slug, list]));
  const within = (contests: ContestConfig[]) => contests.flatMap(({ slug }) => listOf.get(slug) ?? []);
  const asked = selected ? undefined : readOne(query, DOMAIN);
  const direction = directions.filter(gathers).find(({ heading }) => heading === asked);
  const shown = selected ? [selected] : direction ? within(direction.contests) : lists;
  const catalogue = shown.flatMap(({ problems }) => problems);
  const path = selected ? contestHref(selected.contest.slug) : catalogueHref();
  const clearHref = path + (direction ? queryString({ [DOMAIN]: direction.heading }) : "");

  const {
    problems, matched, page, pages, groups, selection, counts, status, sort, sorts, statusCounts,
    summary: { complete: completeProgress, showProgress },
    narrowed, filtered, params: selectionParams, searchValue,
  } = selectProblems({ problems: catalogue, progress, query });
  const filterParams = direction ? selectionParams : without(selectionParams, DOMAIN);

  const rows: FilterRow[] = groups.map((group) => ({
    key: FACET + group.key,
    label: group.label,
    multiple: true,
    selected: selection[group.key],
    choices: group.values.map((value) => ({
      value,
      label: value,
      count: counts.get(group.key)?.get(value),
    })),
  }));
  if (completeProgress) {
    rows.push({
      key: STATUS,
      label: "状态",
      selected: status ? [status] : [],
      choices: STATUSES.map((choice) => ({ ...choice, count: statusCounts.get(choice.value) })),
    });
  }
  rows.push({
    key: SORT,
    label: "排序",
    selected: [sort],
    fallback: DEFAULT_PROBLEM_SORT,
    choices: sorts.map((value) => ({ value, label: SORT_LABEL[value] })),
  });

  const offersFacets = catalogue.some(({ ref }) => ref.contest.facets.length > 0);

  return (
    <div className="space-y-3">
      {narrowed ? (
        <p className="text-fg-subtle text-right text-sm">{matched} / {catalogue.length} 题</p>
      ) : null}

      {selected?.contest.description ? (
        <p className="text-fg-muted text-xs leading-5">{selected.contest.description}</p>
      ) : null}

      {catalogue.length > 0 ? (
        <FilterBar
          path={path}
          params={filterParams}
          rows={rows}
          searchKey={SEARCH}
          searchValue={searchValue}
          searchPlaceholder="搜索题目"
          filtered={filtered}
          clearHref={clearHref}
        />
      ) : null}

      {problems.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
          {catalogue.length === 0 ? (
            selected ? "这个题单暂无题目。" : direction ? "这个方向暂无题目。" : "题库暂无题目。"
          ) : (
            <>
              没有符合条件的题目。
              <Link href={clearHref} className="hover:text-fg ml-1.5 underline underline-offset-2 transition-colors">
                清除筛选
              </Link>
            </>
          )}
        </p>
      ) : (
        <TableFrame>
          <table>
            <thead>
              <tr>
                {showProgress ? <th className="w-24">状态</th> : null}
                <th className="w-36">题号</th>
                <th>题目</th>
                {selected ? null : <th className="hidden md:table-cell">题单</th>}
                {offersFacets ? <th className="hidden sm:table-cell">标签</th> : null}
              </tr>
            </thead>
            <tbody>
              {problems.map((view) => {
                const { contest, problem, entry: listed } = view.ref;
                const mine = progress?.get(progressKey(view));
                return (
                  <tr key={pairKey(contest.slug, problem.slug)}>
                    {showProgress ? (
                      <td>
                        {mine?.verdict ? (
                          <Badge tone={mine.verdict.tone}>{mine.verdict.label}</Badge>
                        ) : (
                          <span className="text-fg-subtle text-xs">{mine ? STATE_LABEL[mine.state] : "—"}</span>
                        )}
                      </td>
                    ) : null}
                    <td className="text-fg-muted font-mono text-xs">{listed.label ?? problem.slug}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className="row-link" href={problemHref(contest.slug, problem.slug)}>
                          {problem.title}
                        </Link>
                        {view.preview ? <Badge tone="warn">未公开</Badge> : null}
                      </div>
                      {contest.facets.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                          <ProblemBadgesSlot config={problem} offered={contest.facets} />
                        </div>
                      ) : null}
                    </td>
                    {selected ? null : (
                      <td className="hidden md:table-cell">
                        <Link
                          href={contestHref(contest.slug)}
                          className="text-fg-muted hover:text-primary text-xs transition-colors"
                        >
                          {contest.title}
                        </Link>
                      </td>
                    )}
                    {offersFacets ? (
                      <td className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          <ProblemBadgesSlot config={problem} offered={contest.facets} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      )}

      <Pagination path={path} params={filterParams} page={page} pages={pages} />
    </div>
  );
}

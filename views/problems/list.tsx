import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import {
  ProblemLists,
  type ProblemListEntry,
  type ProblemListGroup,
} from "@/components/problem/problem-lists";
import { NavigationLinks } from "@/components/site/navigation-links";
import { Badge } from "@/components/ui/badge";
import { FilterBar, type FilterRow } from "@/components/ui/filter-bar";
import { PageHeader, TableFrame } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueHref,
  catalogueSlugs,
  contestHref,
  isCatalogue,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import {
  contestPhase,
  contestStatus,
  pairKey,
  type ContestConfig,
} from "@/lib/contests/types";
import { PAGE_PARAM } from "@/lib/paging";
import { problemsFor, type ProblemView } from "@/lib/problems/access";
import { progressFor } from "@/lib/problems/progress";
import {
  DEFAULT_PROBLEM_SORT,
  SELECTION_PARAMS,
  progressKey,
  selectProblems,
  summarizeProgress,
  type ProblemSort,
} from "@/lib/problems/selection";
import type { ProblemProgress } from "@/lib/problems/views";
import { queryString, without, type SearchParams } from "@/lib/query";

interface Props {
  /** Absent on `/problems`, where every list is shown at once. */
  params?: Promise<{ section?: string }>;
  searchParams: Promise<SearchParams>;
}

const { search: SEARCH, status: STATUS, sort: SORT, facet: FACET } = SELECTION_PARAMS;

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

export async function problemSetMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const section = (await params)?.section;
  const view = section && isCatalogue(section) ? contestFor(section, await getViewer()) : undefined;
  return { title: view?.config.title ?? "题库" };
}

/**
 * The catalogue as one problem table beside its lists. Every catalogued
 * contest is a list; `/problems/[section]` is the same page with one selected.
 *
 * Lists pass `contest.read` and rows `problem.read`, the gates the detail page
 * asks, so nothing here leads to a refusal. Progress counts only work done in
 * the contest a row belongs to, the way that contest's leaderboard does.
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
  const catalogue = selected ? selected.problems : lists.flatMap(({ problems }) => problems);
  const path = selected ? contestHref(selected.contest.slug) : catalogueHref();

  const {
    problems, matched, page, pages, groups, selection, counts, status, sort, sorts, statusCounts,
    summary: { complete: completeProgress, showProgress, solved },
    narrowed, filtered, params: filterParams, searchValue,
  } = selectProblems({ problems: catalogue, progress, query });

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

  // Switching lists keeps the filters and starts from the first page.
  const carried = queryString(without(filterParams, PAGE_PARAM));
  const entry = (title: string, href: string, problems: ProblemView[]): ProblemListEntry => ({
    title,
    href: href + carried,
    total: problems.length,
    solved: summarizeProgress(problems, progress).solved,
  });
  const listGroups: ProblemListGroup[] = groupByDomain(lists).map(({ heading, lists: within }) => ({
    heading,
    lists: within.map((list) => ({
      ...entry(list.contest.title, contestHref(list.contest.slug), list.problems),
      slug: list.contest.slug,
      flags: flagsOf(list),
    })),
  }));

  const offersFacets = catalogue.some(({ ref }) => ref.contest.facets.length > 0);
  const title = selected?.contest.title ?? "全部题目";

  return (
    <div className="space-y-5">
      <PageHeader title="题库" actions={<NavigationLinks viewer={viewer} location="catalogue" />} />

      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <ProblemLists
          all={entry("全部题目", catalogueHref(), lists.flatMap(({ problems }) => problems))}
          groups={listGroups}
          selected={selected?.contest.slug}
        />

        <section aria-label={title} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-fg text-xl font-semibold tracking-tight">{title}</h2>
            {selected ? flagsOf(selected).map((flag) => (
              <Badge key={flag.label} tone={flag.tone}>{flag.label}</Badge>
            )) : null}
            <span className="text-fg-subtle ml-auto text-sm">
              {narrowed ? `${matched} / ${catalogue.length} 题` : `共 ${catalogue.length} 题`}
            </span>
            {selected ? (
              <Link href={standingsHref(selected.contest.slug)} className="text-primary text-sm hover:underline">
                排行榜 →
              </Link>
            ) : null}
          </div>

          {selected?.contest.description || solved !== null ? (
            <div className="text-fg-muted flex flex-wrap items-center justify-between gap-2 text-xs leading-5">
              {selected?.contest.description ? <p>{selected.contest.description}</p> : null}
              {solved !== null ? (
                <span className="shrink-0 font-mono tabular-nums">
                  已通过 {solved} / {catalogue.length} 题
                </span>
              ) : null}
            </div>
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
            />
          ) : null}

          {problems.length === 0 ? (
            <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
              {catalogue.length === 0 ? (
                selected ? "这个题单暂无题目。" : "题库暂无题目。"
              ) : (
                <>
                  没有符合条件的题目。
                  <Link href={path} className="hover:text-fg ml-1.5 underline underline-offset-2 transition-colors">
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
        </section>
      </div>
    </div>
  );
}

/**
 * A catalogue list's normal state is open, and saying so on every visit is
 * noise. Anything else changes what a visitor can do there, so it gets a badge.
 */
function flagsOf({ contest, preview }: List): NonNullable<ProblemListEntry["flags"]> {
  const status = contestPhase(contest) === "running" ? null : contestStatus(contest);
  return [
    ...(preview ? [{ label: "未公开", tone: "warn" as const }] : []),
    ...(status ? [status] : []),
  ];
}

/** Headings in the order their first list appears, lists without one last. */
function groupByDomain(lists: List[]): { heading: string | null; lists: List[] }[] {
  const byHeading = new Map<string | null, List[]>();
  for (const list of lists) {
    const key = list.contest.domain ?? null;
    byHeading.set(key, [...(byHeading.get(key) ?? []), list]);
  }

  const ungrouped = byHeading.get(null);
  byHeading.delete(null);
  return [
    ...[...byHeading].map(([heading, within]) => ({ heading, lists: within })),
    ...(ungrouped ? [{ heading: null, lists: ungrouped }] : []),
  ];
}

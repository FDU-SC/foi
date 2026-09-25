import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemFilters, type FilterRow } from "@/components/problem/filters";
import { Badge } from "@/components/ui/badge";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueHref,
  contestHref,
  isCatalogue,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import { contestPhase, contestStatus } from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { selectProblems, SELECTION_PARAMS, DEFAULT_PROBLEM_SORT } from "@/lib/problems/selection";
import { progressFor } from "@/lib/problems/progress";
import { TableFrame } from "@/components/ui/page";

type Props = PageProps<"/problems/[section]">;

const { search: SEARCH, status: STATUS, sort: SORT, facet: FACET } = SELECTION_PARAMS;

const STATUSES = [
  { value: "solved", label: "已通过" },
  { value: "attempted", label: "尝试过" },
  { value: "untouched", label: "未尝试" },
] as const;

const SORTS = [
  { value: "newest", label: "最新" },
  { value: "listed", label: "题单序" },
  { value: "score", label: "分值" },
];

/** The catalogued contest this URL names, refused the way a missing page is. */
function sectionFor(section: string) {
  return isCatalogue(section) ? section : undefined;
}

export async function problemListMetadata({
  params,
}: Props): Promise<Metadata> {
  const { section } = await params;
  const slug = sectionFor(section);
  const view = slug ? contestFor(slug, await getViewer()) : undefined;

  return { title: view?.config.title ?? "题库" };
}

/**
 * One catalogued contest's problem set, listed by problem rather than by the
 * round it belongs to.
 *
 * It asks the same `problem.read` gate the detail page does, so a card here
 * never leads to a refusal — and the status badge counts only work done in
 * this contest, the way its own leaderboard does.
 */
export async function ProblemListView({ params, searchParams }: Props) {
  const [{ section }, query] = await Promise.all([params, searchParams]);

  const mounted = sectionFor(section);
  if (mounted === undefined) notFound();

  const viewer = await getViewer();

  // Through `contest.read`, the same gate `/contests/[slug]` uses. Reading the
  // config straight out of the registry would show the title and description of
  // a section whose audience this viewer is not in.
  const view = contestFor(mounted, viewer);
  if (!view) notFound();

  const contest = view.config;
  const catalogue = problemsFor(contest.slug, viewer);
  const path = contestHref(contest.slug);

  const statuses = viewer.authenticated ? await progressFor(contest.slug, viewer) : null;
  const offered = contest.facets;
  const {
    problems, groups, selection, counts, status, sort, statusCounts,
    summary: { complete: completeProgress, showProgress, solved },
    narrowed, filtered, params: filterParams, searchValue,
  } = selectProblems({ problems: catalogue, offered, progress: statuses, query });

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
      choices: STATUSES.map((choice) => ({
        ...choice,
        count: statusCounts.get(choice.value),
      })),
    });
  }

  rows.push({
    key: SORT,
    label: "排序",
    selected: [sort],
    fallback: DEFAULT_PROBLEM_SORT,
    choices: SORTS,
  });

  // A catalogue section's normal state is open, and saying so on every visit is
  // noise. Anything else changes what a visitor can do here, so it gets a badge.
  const state =
    contestPhase(contest) === "running" ? null : contestStatus(contest);

  return (
    <div className="space-y-3">
      <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
        <Link
          href={catalogueHref()}
          className="hover:text-fg transition-colors"
        >
          题库
        </Link>
        <span>/</span>
        <span>{contest.title}</span>
      </nav>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">
          {contest.title}
        </h1>
        {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
        <Link
          href={standingsHref(contest.slug)}
          className="text-primary ml-auto text-sm hover:underline"
        >
          查看排行榜 →
        </Link>
        <span className="text-fg-subtle text-sm">
          {narrowed
            ? `${problems.length} / ${catalogue.length} 题`
            : `共 ${catalogue.length} 题`}
        </span>
      </div>

      <div className="text-fg-muted flex flex-wrap items-center justify-between gap-2 text-xs leading-5">
        {contest.description ? <p>{contest.description}</p> : null}
        {solved !== null ? (
          <span className="shrink-0 font-mono tabular-nums">
            已通过 {solved} / {catalogue.length} 题
          </span>
        ) : null}
      </div>

      {catalogue.length > 0 ? (
        <ProblemFilters
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
            "这个分区暂无题目。"
          ) : (
            <>
              没有符合条件的题目。
              <Link
                href={path}
                className="hover:text-fg ml-1.5 underline underline-offset-2 transition-colors"
              >
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
                <th className="w-36">题号</th>
                <th>题目</th>
                {offered.length > 0 ? (
                  <th className="hidden sm:table-cell">标签</th>
                ) : null}
                {showProgress ? <th className="w-28">我的状态</th> : null}
              </tr>
            </thead>
            <tbody>
              {problems.map(({ ref: { problem, entry }, preview }) => {
                const mine = statuses?.get(problem.slug);
                const preset = mine?.verdict;
                return (
                  <tr key={problem.slug}>
                    <td className="text-fg-muted font-mono text-xs">
                      {entry.label ?? problem.slug}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className="row-link"
                          href={problemHref(contest.slug, problem.slug)}
                        >
                          {problem.title}
                        </Link>
                        {preview ? <Badge tone="warn">未公开</Badge> : null}
                      </div>
                      {offered.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                          <ProblemBadgesSlot
                            config={problem}
                            offered={offered}
                          />
                        </div>
                      ) : null}
                    </td>
                    {offered.length > 0 ? (
                      <td className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          <ProblemBadgesSlot
                            config={problem}
                            offered={offered}
                          />
                        </div>
                      </td>
                    ) : null}
                    {showProgress ? (
                      <td>
                        {preset ? (
                          <Badge tone={preset.tone}>{preset.label}</Badge>
                        ) : (
                          <span className="text-fg-subtle text-xs">{mine?.state === "untouched" ? "未尝试" : mine?.state === "attempted" ? "尝试过" : mine?.state === "solved" ? "已通过" : "—"}</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}

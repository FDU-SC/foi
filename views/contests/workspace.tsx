import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { ProblemFilters, type FilterRow } from "@/components/problem/filters";
import { Badge } from "@/components/ui/badge";
import {
  contestFor,
  isContestProblemSetVisibleTo,
} from "@/lib/contests/access";
import {
  catalogueHref,
  contestHref,
  isCatalogue,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import {
  contestPhase,
  contestStatus,
  type ContestConfig,
  type LeaderboardConfig,
} from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { describeVerdict } from "@/lib/presentation";
import { problemsFor, type ProblemView } from "@/lib/problems/access";
import {
  collectFacets,
  facetCounts,
  matchesFacets,
  type FacetSelection,
} from "@/lib/problems/facets";
import type { ProblemConfig } from "@/lib/problems/types";
import { readAll, readOne, type SearchParams } from "@/lib/query";
import { rulesetFor } from "@/lib/standings/registry";
import { computeProblemStatuses, type ProblemStatus } from "@/lib/stats";
import { submissionsFor } from "@/lib/submissions/access";
import { cn } from "@/lib/utils";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

const SEARCH = "q";
const STATUS = "status";
const SORT = "sort";
const FACET = "f.";
const STATUS_DEPTH = 5000;

const STATUSES = [
  { value: "solved", label: "已通过" },
  { value: "attempted", label: "尝试过" },
  { value: "untouched", label: "未尝试" },
];

const SORTS = [
  { value: "newest", label: "最新" },
  { value: "listed", label: "题单序" },
  { value: "score", label: "分值" },
];

const NEWEST = SORTS[0].value;

/**
 * Contest + problem-list chrome around a selected statement.
 *
 * Composed by both the contest page and the problem page: a Next.js layout
 * cannot read `searchParams`, and the catalogue filters are a GET form.
 */
export async function ContestWorkspace({
  contestSlug,
  selected = null,
  searchParams = {},
  children,
}: {
  contestSlug: string;
  selected?: string | null;
  searchParams?: SearchParams;
  children: ReactNode;
}) {
  const viewer = await getViewer();
  const view = contestFor(contestSlug, viewer);
  if (!view) notFound();

  const contest = view.config;
  const now = new Date();
  const catalogue = isCatalogue(contest.slug);
  const problemSetVisible = isContestProblemSetVisibleTo(contest, viewer, now);
  const listed = problemSetVisible
    ? problemsFor(contest.slug, viewer, now)
    : [];

  const statuses: Map<string, ProblemStatus> | null = viewer.authenticated
    ? computeProblemStatuses(
        await submissionsFor(viewer, {
          contestSlug: contest.slug,
          limit: STATUS_DEPTH,
        }),
      )
    : null;

  const filtered = catalogue
    ? applyFilters(listed, contest, searchParams, statuses)
    : {
        problems: listed,
        rows: [] as FilterRow[],
        narrowed: false,
        text: "",
        sort: NEWEST,
      };

  const path = contestHref(contest.slug);
  const solved = statuses
    ? listed.filter(({ ref }) => statuses.get(ref.problem.slug)?.accepted)
        .length
    : null;

  return (
    <div data-workspace className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "border-border min-h-0 w-full shrink-0 overflow-y-auto lg:w-80 lg:border-r",
          selected ? "hidden lg:flex lg:flex-col" : "flex flex-col",
        )}
      >
        <SidebarHeader
          contest={contest}
          catalogue={catalogue}
          problemSetVisible={problemSetVisible}
        />

        {catalogue && solved !== null && listed.length > 0 ? (
          <div className="flex items-center gap-2 px-4 pb-3">
            <div className="bg-primary-subtle h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{
                  width: `${Math.round((solved / listed.length) * 100)}%`,
                }}
              />
            </div>
            <span className="text-fg-subtle font-mono text-xs tabular-nums">
              {solved} / {listed.length} 题
            </span>
          </div>
        ) : null}

        {catalogue && listed.length > 0 ? (
          <div className="px-4 pb-3">
            <ProblemFilters
              path={path}
              params={searchParams}
              rows={filtered.rows}
              searchKey={SEARCH}
              searchValue={readOne(searchParams, SEARCH) ?? ""}
              searchPlaceholder="搜索题目"
              filtered={
                filtered.narrowed ||
                filtered.text.length > 0 ||
                filtered.sort !== NEWEST
              }
              compact
            />
          </div>
        ) : null}

        <ProblemList
          contest={contest}
          catalogue={catalogue}
          visible={problemSetVisible}
          listed={listed}
          problems={filtered.problems}
          statuses={statuses}
          selected={selected}
          path={path}
        />
      </aside>

      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto",
          selected ? "block" : "hidden lg:block",
        )}
      >
        {selected ? (
          <div className="border-border bg-bg/80 sticky top-0 z-10 border-b px-4 py-2.5 backdrop-blur-sm lg:hidden">
            <Link
              href={path}
              className="text-fg-muted hover:text-fg text-sm transition-colors"
            >
              ← 返回题单
            </Link>
          </div>
        ) : null}
        {children}
      </section>
    </div>
  );
}

export function ContestWorkspaceEmpty() {
  return (
    <div className="text-fg-subtle flex h-full min-h-64 items-center justify-center p-8 text-sm">
      从左侧选择一道题目
    </div>
  );
}

function SidebarHeader({
  contest,
  catalogue,
  problemSetVisible,
}: {
  contest: ContestConfig;
  catalogue: boolean;
  problemSetVisible: boolean;
}) {
  const now = new Date();
  const phase = contestPhase(contest, now);
  const status = contestStatus(contest, now);
  const primaryLb: LeaderboardConfig = contest.leaderboards[0];
  const ruleset = rulesetFor(primaryLb.ruleset.id);
  const state = catalogue && phase === "running" ? null : status;

  return (
    <header className="border-border space-y-3 border-b px-4 py-5">
      {catalogue ? (
        <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
          <Link
            href={catalogueHref()}
            className="hover:text-fg transition-colors"
          >
            题库
          </Link>
          <span>/</span>
          <span className="truncate">{contest.title}</span>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
        {catalogue ? null : (
          <Badge>{ruleset?.name ?? primaryLb.ruleset.id}</Badge>
        )}
        {phase === "upcoming" && problemSetVisible ? (
          <Badge tone="warn">预览</Badge>
        ) : null}
      </div>

      <h1 className="text-fg text-lg font-bold tracking-tight">
        {contest.title}
      </h1>

      {contest.description ? (
        <p className="text-fg-muted text-sm leading-6">{contest.description}</p>
      ) : null}

      {catalogue ? null : (
        <>
          <dl className="text-fg-subtle flex flex-col gap-0.5 font-mono text-xs">
            <div>开始 {formatter.format(contest.startsAt)}</div>
            <div>结束 {formatter.format(contest.endsAt)}</div>
            {contest.freezeAt ? (
              <div>封榜 {formatter.format(contest.freezeAt)}</div>
            ) : null}
          </dl>
          {ruleset ? (
            <p className="text-fg-subtle text-xs">{ruleset.description}</p>
          ) : null}
        </>
      )}

      <Link
        href={standingsHref(contest.slug)}
        className="text-primary inline-block text-sm hover:underline"
      >
        查看排行榜 →
      </Link>
    </header>
  );
}

function ProblemList({
  contest,
  catalogue,
  visible,
  listed,
  problems,
  statuses,
  selected,
  path,
}: {
  contest: ContestConfig;
  catalogue: boolean;
  visible: boolean;
  listed: ProblemView[];
  problems: ProblemView[];
  statuses: Map<string, ProblemStatus> | null;
  selected: string | null;
  path: string;
}) {
  const phase = contestPhase(contest);

  if (!visible) {
    return (
      <p className="text-fg-subtle px-4 py-8 text-center text-sm">
        {phase === "ended"
          ? "这场比赛已经结束，它的题目不再公开。"
          : `题目将在 ${formatter.format(contest.startsAt)} 开赛时公开。`}
      </p>
    );
  }

  if (listed.length === 0) {
    return (
      <p className="text-fg-subtle px-4 py-8 text-center text-sm">
        {catalogue
          ? "这个方向还在筹备，题目随后会挂上来。"
          : "这场比赛还没有添加题目。"}
      </p>
    );
  }

  if (problems.length === 0) {
    return (
      <p className="text-fg-subtle px-4 py-8 text-center text-sm">
        没有符合条件的题目。
        <Link
          href={path}
          className="hover:text-fg ml-1.5 underline underline-offset-2 transition-colors"
        >
          清除筛选
        </Link>
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y">
      {problems.map((view) => (
        <ProblemRow
          key={view.ref.problem.slug}
          view={view}
          contestSlug={contest.slug}
          selected={selected === view.ref.problem.slug}
          mine={statuses?.get(view.ref.problem.slug)}
          showPoints={!catalogue}
        />
      ))}
    </ul>
  );
}

function ProblemRow({
  view,
  contestSlug,
  selected,
  mine,
  showPoints,
}: {
  view: ProblemView;
  contestSlug: string;
  selected: boolean;
  mine: ProblemStatus | undefined;
  showPoints: boolean;
}) {
  const { entry, problem } = view.ref;
  const preset = mine
    ? describeVerdict(problem.slug, { status: mine.status })
    : null;
  const accepted = mine?.accepted === true;

  return (
    <li>
      <Link
        href={problemHref(contestSlug, problem.slug)}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 px-4 py-2.5 transition-colors",
          selected
            ? "bg-primary-subtle border-primary border-l-2"
            : "hover:bg-surface-2 border-l-2 border-transparent",
          accepted && !selected && "bg-ok-subtle/30",
        )}
      >
        {entry.label ? (
          <span className="bg-surface-3 text-fg flex size-6 shrink-0 items-center justify-center rounded font-mono text-xs font-semibold">
            {entry.label}
          </span>
        ) : null}
        <span className="text-fg min-w-0 flex-1 truncate text-sm font-medium">
          {problem.title}
        </span>
        {view.preview ? <Badge tone="warn">未公开</Badge> : null}
        {mine && preset ? (
          <Badge tone={preset.tone} mono title={preset.label}>
            {preset.short}
          </Badge>
        ) : null}
        {showPoints ? (
          <span className="text-fg-subtle font-mono text-xs tabular-nums">
            {entry.points ?? problem.maxScore}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function applyFilters(
  catalogue: ProblemView[],
  contest: ContestConfig,
  query: SearchParams,
  statuses: Map<string, ProblemStatus> | null,
) {
  const offered = contest.facets;
  const groups = collectFacets(
    catalogue.map(({ ref }) => ref.problem),
    offered,
  );
  const selection: FacetSelection = Object.fromEntries(
    groups.map((group) => [group.key, readAll(query, FACET + group.key)]),
  );
  const text = readOne(query, SEARCH)?.trim().toLowerCase() ?? "";
  const status = statuses ? pick(readOne(query, STATUS), STATUSES) : undefined;
  const sort = pick(readOne(query, SORT), SORTS) ?? NEWEST;

  const beforeFacets = catalogue.filter(
    ({ ref }) =>
      matchesQuery(ref.problem, text) &&
      matchesStatus(status, statuses?.get(ref.problem.slug)),
  );
  const beforeStatus = catalogue.filter(
    ({ ref }) =>
      matchesQuery(ref.problem, text) &&
      matchesFacets(ref.problem, offered, selection),
  );
  const counts = facetCounts(
    beforeFacets.map(({ ref }) => ref.problem),
    offered,
    groups,
    selection,
  );
  const problems = sorted(
    beforeFacets.filter(({ ref }) =>
      matchesFacets(ref.problem, offered, selection),
    ),
    sort,
  );

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

  if (statuses) {
    rows.push({
      key: STATUS,
      label: "状态",
      selected: status ? [status] : [],
      choices: STATUSES.map((choice) => ({
        ...choice,
        count: beforeStatus.filter(({ ref }) =>
          matchesStatus(choice.value, statuses.get(ref.problem.slug)),
        ).length,
      })),
    });
  }

  rows.push({
    key: SORT,
    label: "排序",
    selected: [sort],
    fallback: NEWEST,
    choices: SORTS,
  });

  return {
    problems,
    rows,
    narrowed: problems.length !== catalogue.length,
    text,
    sort,
  };
}

function pick(
  asked: string | undefined,
  from: { value: string }[],
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
  mine: ProblemStatus | undefined,
): boolean {
  if (status === "solved") return mine?.accepted === true;
  if (status === "attempted") return mine !== undefined && !mine.accepted;
  if (status === "untouched") return mine === undefined;
  return true;
}

function worth({ ref }: ProblemView): number {
  return ref.entry.points ?? ref.problem.maxScore;
}

function sorted(views: ProblemView[], sort: string): ProblemView[] {
  if (sort === "score") return [...views].sort((a, b) => worth(b) - worth(a));
  if (sort === "newest") return views.toReversed();
  return views;
}

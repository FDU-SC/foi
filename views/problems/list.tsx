import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemFilters, type FilterRow } from "@/components/problem/filters";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueHref,
  contestHref,
  isCatalogue,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import { contestPhase, contestStatus } from "@/lib/contests/types";
import { describeVerdict } from "@/lib/presentation";
import { problemsFor, type ProblemView } from "@/lib/problems/access";
import {
  collectFacets,
  facetCounts,
  matchesFacets,
  type FacetSelection,
} from "@/lib/problems/facets";
import type { ProblemConfig } from "@/lib/problems/types";
import { readAll, readOne } from "@/lib/query";
import { computeProblemStatuses, type ProblemStatus } from "@/lib/stats";
import { submissionsFor } from "@/lib/submissions/access";
import { cn } from "@/lib/utils";

type Props = PageProps<"/problems/[section]">;

/**
 * Parameters this page owns. Facet keys carry a prefix, so a dimension a
 * deployment invents can never shadow one of these.
 */
const SEARCH = "q";
const STATUS = "status";
const SORT = "sort";
const FACET = "f.";

/** How far back the status column looks. Beyond this the oldest attempts drop out. */
const STATUS_DEPTH = 5000;

const STATUSES = [
  { value: "solved", label: "已通过" },
  { value: "attempted", label: "尝试过" },
  { value: "untouched", label: "未尝试" },
];

const SORTS = [
  { value: "listed", label: "题单序" },
  { value: "score", label: "分值" },
];

const LISTED = SORTS[0].value;

const LIFT = [
  "ui-lift border-border bg-surface/80 hover:border-primary/40 hover:bg-surface rounded-xl border",
  "shadow-[0_1px_0_oklch(100%_0_0/0.04)] hover:shadow-[0_16px_40px_-24px_var(--primary)]",
].join(" ");

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

/** What this section is worth a problem, which the contest may override. */
function worth({ ref }: ProblemView): number {
  return ref.entry.points ?? ref.problem.maxScore;
}

function sorted(views: ProblemView[], sort: string): ProblemView[] {
  if (sort === "score") return [...views].sort((a, b) => worth(b) - worth(a));
  return views;
}

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

  const statuses: Map<string, ProblemStatus> | null = viewer.authenticated
    ? computeProblemStatuses(
        await submissionsFor(viewer, {
          contestSlug: contest.slug,
          limit: STATUS_DEPTH,
        }),
      )
    : null;

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
  const sort = pick(readOne(query, SORT), SORTS) ?? LISTED;

  // Counts answer "how many would this choice leave", so each dimension is
  // measured against every criterion except its own.
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
    fallback: LISTED,
    choices: SORTS,
  });

  const narrowed = problems.length !== catalogue.length;
  const solved = statuses
    ? catalogue.filter(({ ref }) => statuses.get(ref.problem.slug)?.accepted)
        .length
    : null;

  // A catalogue section's normal state is open, and saying so on every visit is
  // noise. Anything else changes what a visitor can do here, so it gets a badge.
  const state =
    contestPhase(contest) === "running" ? null : contestStatus(contest);

  return (
    <div className="space-y-5">
      <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
        <Link href={catalogueHref()} className="hover:text-fg transition-colors">
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

      {contest.description ? (
        <p className="text-fg-muted leading-7">{contest.description}</p>
      ) : null}

      {solved !== null && catalogue.length > 0 ? (
        <div className="flex max-w-xs items-center gap-2">
          <div className="bg-primary-subtle h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{
                width: `${Math.round((solved / catalogue.length) * 100)}%`,
              }}
            />
          </div>
          <span className="text-fg-subtle font-mono text-xs tabular-nums">
            {solved} / {catalogue.length} 题
          </span>
        </div>
      ) : null}

      {catalogue.length > 0 ? (
        <ProblemFilters
          path={path}
          params={query}
          rows={rows}
          searchKey={SEARCH}
          searchValue={readOne(query, SEARCH) ?? ""}
          searchPlaceholder="按题目名或编号搜索"
          filtered={narrowed || text.length > 0 || sort !== LISTED}
        />
      ) : null}

      {problems.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-xl border py-12 text-center text-sm">
          {catalogue.length === 0 ? (
            "这个方向还在筹备，题目随后会挂上来。"
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {problems.map(({ ref: { problem, entry }, preview }, index) => {
            const mine = statuses?.get(problem.slug);
            const preset = mine
              ? describeVerdict(problem.slug, { status: mine.status })
              : null;
            const accepted = mine?.accepted === true;

            return (
              <Link
                key={problem.slug}
                href={problemHref(contest.slug, problem.slug)}
                style={revealDelay(index)}
                className={cn(
                  "group flex flex-col gap-3 p-4",
                  LIFT,
                  accepted && "border-ok/30 bg-ok-subtle/20",
                  revealClass,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="bg-surface-3 text-fg flex size-8 shrink-0 items-center justify-center rounded font-mono text-xs font-semibold">
                    {entry.label}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {preview ? <Badge tone="warn">未公开</Badge> : null}
                    {mine && preset ? (
                      <Badge tone={preset.tone} mono title={preset.label}>
                        {preset.short}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <h2 className="text-fg group-hover:text-primary font-semibold transition-colors">
                  {problem.title}
                </h2>

                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <ProblemBadgesSlot config={problem} offered={offered} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

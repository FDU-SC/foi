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
 * It asks the same `problem.read` gate the detail page does, so a row here
 * never leads to a refusal — and the status column counts only work done in
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

      <div className="border-border bg-surface/70 overflow-hidden rounded-xl border backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/80">
            <tr className="text-fg-muted text-xs">
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                编号
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                题目
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                我的状态
              </th>
              <th className="border-border border-b px-4 py-2.5 text-left font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {problems.map(({ ref: { problem }, preview }, index) => {
              const mine = statuses?.get(problem.slug);
              const preset = mine
                ? describeVerdict(problem.slug, { status: mine.status })
                : null;

              return (
                <tr
                  key={problem.slug}
                  style={revealDelay(index)}
                  className={cn(
                    "hover:bg-surface-2/70 shadow-[inset_3px_0_0_0_transparent]",
                    "transition-[background-color,box-shadow] duration-200 hover:shadow-[inset_3px_0_0_0_var(--primary)]",
                    revealClass,
                  )}
                >
                  <td className="text-fg-subtle px-4 py-2.5 font-mono text-xs">
                    {problem.slug}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={problemHref(contest.slug, problem.slug)}
                      className="text-fg hover:text-primary font-medium transition-colors"
                    >
                      {problem.title}
                    </Link>
                    {preview ? (
                      <Badge tone="warn" className="ml-2">
                        未公开
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    {mine && preset ? (
                      <Badge tone={preset.tone} mono title={preset.label}>
                        {preset.short}
                      </Badge>
                    ) : (
                      <span className="text-fg-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ProblemBadgesSlot config={problem} offered={offered} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {problems.length === 0 ? (
          <p className="text-fg-subtle px-4 py-12 text-center text-sm">
            {catalogue.length === 0 ? (
              `这个分区还没有题目。在 content/contests/${contest.slug}/contest.ts 的 problems 中登记。`
            ) : (
              <>
                没有符合条件的题目。
                <Link
                  href={path}
                  className="hover:text-fg underline underline-offset-2 transition-colors"
                >
                  清除筛选
                </Link>
              </>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

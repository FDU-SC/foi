import Link from "next/link";
import { getSessionUser, getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemFilters, type FilterRow } from "@/components/problem/filters";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { viewerFor } from "@/lib/authz/viewer";
import { describeVerdict } from "@/lib/presentation";
import {
  byRecency,
  problemsFor,
  type ProblemView,
} from "@/lib/problems/access";
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

const PATH = "/problems";

/**
 * Parameters the catalogue owns. Facet keys carry a prefix, so a dimension a
 * deployment invents can never shadow one of these.
 */
const SEARCH = "q";
const STATUS = "status";
const SORT = "sort";
const FACET = "f.";

const STATUSES = [
  { value: "solved", label: "已通过" },
  { value: "attempted", label: "尝试过" },
  { value: "untouched", label: "未尝试" },
];

const SORTS = [
  { value: "catalogue", label: "目录序" },
  { value: "recent", label: "最新" },
  { value: "score", label: "分值" },
];

const CATALOGUE = SORTS[0].value;

function pick(asked: string | undefined, from: { value: string }[]): string | undefined {
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

function sorted(views: ProblemView[], sort: string | undefined): ProblemView[] {
  if (sort === "recent") {
    return [...views].sort((a, b) => byRecency(a.config, b.config));
  }
  if (sort === "score") {
    return [...views].sort((a, b) => b.config.maxScore - a.config.maxScore);
  }
  return views;
}

export async function ProblemListView({
  searchParams,
}: PageProps<"/problems">) {
  const [viewer, user, params] = await Promise.all([
    getViewer(),
    getSessionUser(),
    searchParams,
  ]);

  const catalogue = problemsFor(viewer);

  // 登录用户看到自己尝试过的题的状态：有 AC 显示 AC，否则显示最近一次结果。
  const statuses = user
    ? computeProblemStatuses(
        await submissionsFor(viewerFor(user), { limit: 5000 }),
      )
    : null;

  const groups = collectFacets(catalogue.map((view) => view.config));

  const selection: FacetSelection = Object.fromEntries(
    groups.map((group) => [group.key, readAll(params, FACET + group.key)]),
  );

  const query = readOne(params, SEARCH)?.trim().toLowerCase() ?? "";
  const status = statuses ? pick(readOne(params, STATUS), STATUSES) : undefined;
  const sort = pick(readOne(params, SORT), SORTS) ?? CATALOGUE;

  // Counts answer "how many would this choice leave", so each dimension is
  // measured against every criterion except its own.
  const beforeFacets = catalogue.filter(
    ({ config }) =>
      matchesQuery(config, query) &&
      matchesStatus(status, statuses?.get(config.slug)),
  );
  const beforeStatus = catalogue.filter(
    ({ config }) =>
      matchesQuery(config, query) && matchesFacets(config, selection),
  );

  const counts = facetCounts(
    beforeFacets.map((view) => view.config),
    groups,
    selection,
  );

  const problems = sorted(
    beforeFacets.filter(({ config }) => matchesFacets(config, selection)),
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
        count: beforeStatus.filter(({ config }) =>
          matchesStatus(choice.value, statuses.get(config.slug)),
        ).length,
      })),
    });
  }

  rows.push({
    key: SORT,
    label: "排序",
    selected: [sort],
    fallback: CATALOGUE,
    choices: SORTS,
  });

  const narrowed = problems.length !== catalogue.length;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-fg text-2xl font-bold tracking-tight">题库</h1>
        <span className="text-fg-subtle text-sm">
          {narrowed
            ? `${problems.length} / ${catalogue.length} 题`
            : `共 ${catalogue.length} 题`}
        </span>
      </div>

      {catalogue.length > 0 ? (
        <ProblemFilters
          path={PATH}
          params={params}
          rows={rows}
          searchKey={SEARCH}
          searchValue={readOne(params, SEARCH) ?? ""}
          searchPlaceholder="按题目名或编号搜索"
          filtered={narrowed || query.length > 0 || sort !== CATALOGUE}
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
            {problems.map(({ config: problem, preview }, index) => {
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
                      href={`/problems/${problem.slug}`}
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
                      <ProblemBadgesSlot config={problem} />
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
              "还没有题目。在 content/problems 下新建一个目录即可。"
            ) : (
              <>
                没有符合条件的题目。
                <Link
                  href={PATH}
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

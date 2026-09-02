import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser, getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemSearch } from "@/components/problem/search";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { viewerFor } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueSlug,
  contestHref,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import { contestPhase, contestStatus } from "@/lib/contests/types";
import { describeVerdict } from "@/lib/presentation";
import { problemsFor } from "@/lib/problems/access";
import type { ProblemConfig } from "@/lib/problems/types";
import { readOne } from "@/lib/query";
import { computeProblemStatuses, type ProblemStatus } from "@/lib/stats";
import { submissionsFor } from "@/lib/submissions/access";
import { cn } from "@/lib/utils";

const SEARCH = "q";

/** How far back the status column looks. Beyond this the oldest attempts drop out. */
const STATUS_DEPTH = 5000;

export async function problemListMetadata(): Promise<Metadata> {
  const mounted = catalogueSlug();
  const view = mounted ? contestFor(mounted, await getViewer()) : undefined;

  return { title: view?.config.title ?? "题库" };
}

function matchesQuery(config: ProblemConfig, query: string): boolean {
  if (query.length === 0) return true;
  return (
    config.title.toLowerCase().includes(query) || config.slug.includes(query)
  );
}

/**
 * The catalogue: one contest's problem set, listed by problem rather than by
 * the round it belongs to.
 *
 * It asks the same `problem.read` gate the detail page does, so a row here
 * never leads to a refusal — and the status column counts only work done in
 * this contest, the way its own leaderboard does.
 */
export async function ProblemListView({ searchParams }: PageProps<"/problems">) {
  const mounted = catalogueSlug();
  if (mounted === undefined) notFound();

  const [viewer, user, params] = await Promise.all([
    getViewer(),
    getSessionUser(),
    searchParams,
  ]);

  // Through `contest.read`, the same gate `/contests/[slug]` uses. Reading the
  // config straight out of the registry would show the title and description of
  // a catalogue whose audience this viewer is not in.
  const view = contestFor(mounted, viewer);
  if (!view) notFound();

  const contest = view.config;
  const catalogue = problemsFor(contest.slug, viewer);

  const statuses: Map<string, ProblemStatus> | null = user
    ? computeProblemStatuses(
        await submissionsFor(viewerFor(user), {
          contestSlug: contest.slug,
          limit: STATUS_DEPTH,
        }),
      )
    : null;

  const query = readOne(params, SEARCH)?.trim().toLowerCase() ?? "";
  const problems = catalogue.filter(({ ref }) =>
    matchesQuery(ref.problem, query),
  );

  const narrowed = problems.length !== catalogue.length;

  // A catalogue's normal state is open, and saying so on every visit is noise.
  // Anything else changes what a visitor can do here, so it gets a badge.
  const status = contestPhase(contest) === "running" ? null : contestStatus(contest);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">
          {contest.title}
        </h1>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
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
        <ProblemSearch
          path={contestHref(contest.slug)}
          params={params}
          name={SEARCH}
          value={readOne(params, SEARCH) ?? ""}
          placeholder="按题目名或编号搜索"
          filtered={narrowed || query.length > 0}
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
              `题库还没有题目。在 content/contests/${contest.slug}/contest.ts 的 problems 中登记。`
            ) : (
              <>
                没有符合条件的题目。
                <Link
                  href={contestHref(contest.slug)}
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

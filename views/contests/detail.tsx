import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { ContestNav } from "@/components/contests/contest-nav";
import { PageHeader, EmptyState, TableFrame } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import {
  contestFor,
  isContestProblemSetVisibleTo,
} from "@/lib/contests/access";
import { problemHref } from "@/lib/contests/catalogue";
import { contestPhase, contestStatus } from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { problemsFor } from "@/lib/problems/access";
import { rulesetFor } from "@/lib/standings/registry";
import type { LeaderboardConfig } from "@/lib/contests/types";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

export async function contestDetailMetadata({
  params,
}: PageProps<"/contests/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  return { title: view?.config.title ?? "比赛" };
}

export async function ContestDetailView({
  params,
}: PageProps<"/contests/[slug]">) {
  const { slug } = await params;
  const viewer = await getViewer();

  const view = contestFor(slug, viewer);
  if (!view) notFound();

  const contest = view.config;
  const primaryLb: LeaderboardConfig = contest.leaderboards[0];
  const ruleset = rulesetFor(primaryLb.ruleset.id);

  const now = new Date();
  const phase = contestPhase(contest, now);
  const status = contestStatus(contest, now);
  const problemSetVisible = isContestProblemSetVisibleTo(contest, viewer, now);

  // Listed through the same gate the problem page enforces, so a link here
  // never leads to a refusal.
  const problems = problemsFor(contest.slug, viewer, now).map(({ ref }) => ref);

  return (
    <div className="space-y-4">
      <PageHeader
        title={contest.title}
        description={contest.description}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <ContestNav slug={contest.slug} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <aside className="oj-sidebar lg:col-start-2 lg:row-start-1">
          <h2 className="mb-3 text-sm font-semibold">比赛信息</h2>
          <dl className="grid-cols-2 lg:grid-cols-1">
            <div>
              <dt>开始时间</dt>
              <dd>{formatter.format(contest.startsAt)}</dd>
            </div>
            <div>
              <dt>结束时间</dt>
              <dd>{formatter.format(contest.endsAt)}</dd>
            </div>
            {contest.freezeAt ? (
              <div>
                <dt>封榜时间</dt>
                <dd>{formatter.format(contest.freezeAt)}</dd>
              </div>
            ) : null}
            <div>
              <dt>赛制</dt>
              <dd>{ruleset?.name ?? primaryLb.ruleset.id}</dd>
            </div>
          </dl>
          {ruleset ? (
            <p className="text-fg-muted mt-3 border-t pt-3 text-xs leading-5">
              {ruleset.description}
            </p>
          ) : null}
        </aside>
        <section className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">题目</h2>
            {phase === "upcoming" && problemSetVisible ? (
              <Badge tone="warn">预览 · 尚未对选手公开</Badge>
            ) : null}
          </div>
          {!problemSetVisible ? (
            <EmptyState>
              {phase === "ended"
                ? "这场比赛的题目不再公开。"
                : `题目将在 ${formatter.format(contest.startsAt)} 开赛时公开。`}
            </EmptyState>
          ) : problems.length === 0 ? (
            <EmptyState>这场比赛暂无题目。</EmptyState>
          ) : (
            <TableFrame>
              <table>
                <thead>
                  <tr>
                    <th className="w-24">题号</th>
                    <th>题目</th>
                    <th className="numeric">分值</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map(({ entry, problem }) => (
                    <tr key={problem.slug}>
                      <td className="text-fg-muted font-mono text-xs">
                        {entry.label ?? problem.slug}
                      </td>
                      <td>
                        <Link
                          className="row-link"
                          href={problemHref(contest.slug, problem.slug)}
                        >
                          {problem.title}
                        </Link>
                      </td>
                      <td className="numeric font-mono text-xs">
                        {entry.points ?? problem.maxScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </section>
      </div>
    </div>
  );
}

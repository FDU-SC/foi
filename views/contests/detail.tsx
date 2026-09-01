import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import {
  contestFor,
  isContestProblemSetVisibleTo,
} from "@/lib/contests/access";
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
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="border-border border-b pb-5">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge>{ruleset?.name ?? primaryLb.ruleset.id}</Badge>
        </div>
        <h1 className="text-fg text-2xl font-bold tracking-tight">
          {contest.title}
        </h1>
        {contest.description ? (
          <p className="text-fg-muted mt-2 leading-7">{contest.description}</p>
        ) : null}
        <dl className="text-fg-subtle mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
          <div>开始 {formatter.format(contest.startsAt)}</div>
          <div>结束 {formatter.format(contest.endsAt)}</div>
          {contest.freezeAt ? (
            <div>封榜 {formatter.format(contest.freezeAt)}</div>
          ) : null}
        </dl>
        {ruleset ? (
          <p className="text-fg-subtle mt-3 text-xs">{ruleset.description}</p>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-fg text-lg font-semibold">题目</h2>

        {phase === "upcoming" && problemSetVisible ? (
          <Badge tone="warn">预览 · 尚未对选手公开</Badge>
        ) : null}
        <Link
          href={`/contests/${contest.slug}/standings`}
          className="text-primary ml-auto text-sm hover:underline"
        >
          查看排行榜 →
        </Link>
      </div>

      {!problemSetVisible ? (
        <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
          {phase === "ended"
            ? "这场比赛已经结束，它的题目不再公开。"
            : `题目将在 ${formatter.format(contest.startsAt)} 开赛时公开。`}
        </p>
      ) : problems.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
          这场比赛还没有添加题目。
          <br />
          在{" "}
          <code className="font-mono">
            content/contests/{contest.slug}/contest.ts
          </code>{" "}
          的 problems 中登记。
        </p>
      ) : (
        <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
          {problems.map(({ entry, problem }) => (
            <li key={problem.slug}>
              <Link
                href={`/contests/${contest.slug}/problems/${problem.slug}`}
                className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3 transition-colors"
              >
                <span className="bg-surface-3 text-fg flex size-6 shrink-0 items-center justify-center rounded font-mono text-xs font-semibold">
                  {entry.label}
                </span>
                <span className="text-fg flex-1 truncate font-medium">
                  {problem.title}
                </span>
                <span className="text-fg-subtle font-mono text-xs tabular-nums">
                  {entry.points ?? problem.maxScore}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

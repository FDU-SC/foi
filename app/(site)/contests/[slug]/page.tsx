import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import {
  contestFor,
  isContestProblemSetVisible,
} from "@/lib/contests/access";
import { resolveContestProblems } from "@/lib/contests/queries";
import { contestPhase, PHASE_LABEL } from "@/lib/contests/types";
import { rulesetFor } from "@/lib/standings/registry";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/contests/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  return { title: view?.config.title ?? "比赛" };
}

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ContestPage({
  params,
}: PageProps<"/contests/[slug]">) {
  const { slug } = await params;
  const viewer = await getViewer();
  const preview = viewer.can("problem.viewAll");

  const view = contestFor(slug, viewer);
  if (!view) notFound();

  const contest = view.config;
  const ruleset = rulesetFor(contest.slug, contest.ruleset.id);
  const phase = contestPhase(contest);

  // Before the start the problem set is itself the secret: how many problems
  // there are, what they are called and what they are worth all describe the
  // round without opening a single statement.
  const problemSetVisible = isContestProblemSetVisible(contest);
  const problems =
    problemSetVisible || preview ? resolveContestProblems(contest) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="border-border border-b pb-5">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={phase === "running" ? "ok" : "neutral"}>
            {PHASE_LABEL[phase]}
          </Badge>
          <Badge>{ruleset?.name ?? contest.ruleset.id}</Badge>
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
        {!problemSetVisible && preview ? (
          <Badge tone="warn">预览 · 尚未对选手公开</Badge>
        ) : null}
        <Link
          href={`/contests/${contest.slug}/standings`}
          className="text-primary ml-auto text-sm hover:underline"
        >
          查看排行榜 →
        </Link>
      </div>

      {!problemSetVisible && !preview ? (
        <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
          题目将在 {formatter.format(contest.startsAt)} 开赛时公开。
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
          {problems.map((problem) => (
            <li key={problem.slug}>
              <Link
                href={`/problems/${problem.slug}?contest=${contest.slug}`}
                className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3 transition-colors"
              >
                <span className="bg-surface-3 text-fg flex size-6 shrink-0 items-center justify-center rounded font-mono text-xs font-semibold">
                  {problem.label}
                </span>
                <span className="text-fg flex-1 truncate font-medium">
                  {problem.title}
                </span>
                <span className="text-fg-subtle font-mono text-xs tabular-nums">
                  {problem.points ?? problem.maxScore}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

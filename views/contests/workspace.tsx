import type { ReactNode } from "react";
import { getViewer } from "@/auth";
import { ContestNav } from "@/components/contests/contest-nav";
import { ContestWorkspace } from "@/components/contests/workspace";
import styles from "@/components/contests/workspace.module.css";
import { Badge } from "@/components/ui/badge";
import { contestFor, isContestProblemSetVisibleTo } from "@/lib/contests/access";
import { contestHref, problemHref } from "@/lib/contests/catalogue";
import { contestPhase, contestStatus } from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { problemsFor } from "@/lib/problems/access";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

export async function ContestWorkspaceView({ params, children }: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  const { slug } = await params;
  const viewer = await getViewer();
  const view = contestFor(slug, viewer);
  // A problem's read permission does not require contest.read.
  if (!view) return children;

  const contest = view.config;
  const now = new Date();
  const status = contestStatus(contest, now);
  const visible = isContestProblemSetVisibleTo(contest, viewer, now);
  const problems = visible ? problemsFor(slug, viewer, now) : [];
  const empty = !visible
    ? contestPhase(contest, now) === "ended"
      ? "这场比赛的题目不再公开。"
      : `题目将在 ${formatter.format(contest.startsAt)} 开赛时公开。`
    : "这场比赛暂无题目。";

  return (
    <div className="space-y-4">
      <header className={styles.header}>
        <div className="px-4 pt-5 pb-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 text-2xl font-bold tracking-tight wrap-anywhere">{contest.title}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <dl className="text-fg-muted mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs leading-5">
            <div className="flex flex-wrap gap-x-2"><dt>开始时间</dt><dd><time dateTime={contest.startsAt.toISOString()}>{formatter.format(contest.startsAt)}</time></dd></div>
            <div className="flex flex-wrap gap-x-2"><dt>结束时间</dt><dd><time dateTime={contest.endsAt.toISOString()}>{formatter.format(contest.endsAt)}</time></dd></div>
          </dl>
        </div>
        <div className="border-t px-4 sm:px-6"><ContestNav slug={slug} /></div>
      </header>
      <ContestWorkspace
        overviewHref={contestHref(slug)}
        empty={empty}
        showCount={visible}
        preview={visible && contestPhase(contest, now) === "upcoming"}
        problems={problems.map(({ ref: { entry, problem } }) => ({
          href: problemHref(slug, problem.slug),
          label: entry.label ?? problem.slug,
          title: problem.title,
          points: entry.points ?? problem.maxScore,
        }))}
      >
        {children}
      </ContestWorkspace>
    </div>
  );
}

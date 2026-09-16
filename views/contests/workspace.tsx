import type { ReactNode } from "react";
import { getViewer } from "@/auth";
import { ContestNav } from "@/components/contests/contest-nav";
import { ContestWorkspace } from "@/components/contests/workspace";
import { PageHeader } from "@/components/ui/page";
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
      <PageHeader title={contest.title} actions={<Badge tone={status.tone}>{status.label}</Badge>} />
      <ContestNav slug={slug} />
      <ContestWorkspace
        overviewHref={contestHref(slug)}
        empty={empty}
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

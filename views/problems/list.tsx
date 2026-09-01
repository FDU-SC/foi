import Link from "next/link";
import { getSessionUser, getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { Badge } from "@/components/ui/badge";
import { describeVerdict } from "@/lib/presentation";
import { problemsFor } from "@/lib/problems/access";
import { computeProblemStatuses, type ProblemStatus } from "@/lib/stats";
import { submissionsFor } from "@/lib/submissions/access";
import { viewerFor } from "@/lib/authz/viewer";

export async function ProblemListView() {
  const [viewer, user] = await Promise.all([getViewer(), getSessionUser()]);
  const problems = problemsFor(viewer);

  // 登录用户看到自己尝试过的题的状态：有 AC 显示 AC，否则显示最近一次结果。
  let statuses: Map<string, ProblemStatus> | null = null;
  if (user) {
    const mine = await submissionsFor(viewerFor(user), { limit: 5000 });
    statuses = computeProblemStatuses(mine);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-fg text-2xl font-bold tracking-tight">题库</h1>
        <span className="text-fg-subtle text-sm">共 {problems.length} 题</span>
      </div>

      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
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
            {problems.map(({ config: problem, preview }) => {
              const mine = statuses?.get(problem.slug);
              const preset = mine
                ? describeVerdict(problem.slug, { status: mine.status })
                : null;

              return (
                <tr key={problem.slug} className="hover:bg-surface-2/60">
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
            还没有题目。在 content/problems 下新建一个目录即可。
          </p>
        ) : null}
      </div>
    </div>
  );
}

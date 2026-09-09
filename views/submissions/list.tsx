import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { viewerFor } from "@/lib/authz/viewer";
import { isSettled } from "@/lib/backend/types";
import { dateFormatter } from "@/lib/format";
import { submissionsFor } from "@/lib/submissions/access";
import { locateInQueues } from "@/lib/submissions/queue-position";
import { PageHeader } from "@/components/ui/page";

const formatter = dateFormatter({ dateStyle: "short", timeStyle: "medium" });

export async function SubmissionListView() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/submissions");

  const rows = await submissionsFor(viewerFor(user), { limit: 50 });

  const positions = await locateInQueues(
    rows.filter((row) => !isSettled(row.state)).map((row) => row.id),
  );

  return (
    <div className="space-y-5">
      <PageHeader title="我的提交" description="最近 50 条提交记录" />

      {rows.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border bg-surface py-10 text-center text-sm">
          还没有提交记录。
        </p>
      ) : (
        <div className="oj-table-frame">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-2">
              <tr className="text-fg-muted text-xs">
                <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                  时间
                </th>
                <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                  题目
                </th>
                <th className="border-border border-b px-4 py-2.5 text-left font-semibold">
                  结果
                </th>
                <th className="border-border border-b px-4 py-2.5 text-right font-semibold">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-2/60">
                  <td className="text-fg-subtle px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                    {formatter.format(new Date(row.createdAt))}
                  </td>
                  <td className="px-4 py-2.5">
                    <ProblemRef
                      contestSlug={row.contestSlug}
                      slug={row.problemSlug}
                      fallbackTitle={row.problemTitle}
                      className="text-fg font-medium"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <VerdictBadge submission={row} />
                      <QueueBadge queue={positions.get(row.id)} showJudge />
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/submissions/${row.id}`}
                      className="text-fg-subtle hover:text-primary text-xs transition-colors"
                    >
                      详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

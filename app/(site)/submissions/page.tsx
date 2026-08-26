import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { viewerFor } from "@/lib/auth/viewer";
import { isSettled } from "@/lib/backend/types";
import { submissionsFor } from "@/lib/submissions/access";
import { locateInQueues } from "@/lib/submissions/queue-position";

export const metadata: Metadata = { title: "提交记录" };
export const dynamic = "force-dynamic";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "medium",
});

export default async function SubmissionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/submissions");

  // Scoped by the viewer, not by an argument this page has to remember.
  const rows = await submissionsFor(viewerFor(user), { limit: 50 });

  // One sweep of the judges covers every unfinished row on the page.
  const positions = await locateInQueues(
    rows.filter((row) => !isSettled(row.state)).map((row) => row.id),
  );

  return (
    <div className="space-y-5">
      <h1 className="text-fg text-2xl font-bold tracking-tight">我的提交</h1>

      {rows.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有提交记录。
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
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

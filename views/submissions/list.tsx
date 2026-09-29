import { NavigationLinks } from "@/components/site/navigation-links";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { viewerFor } from "@/lib/authz/viewer";
import { dateFormatter } from "@/lib/format";
import { submissionsFor } from "@/lib/submissions/access";
import { EmptyState, PageHeader, TableFrame } from "@/components/ui/page";

const formatter = dateFormatter({ dateStyle: "short", timeStyle: "medium" });

export async function SubmissionListView() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/submissions");

  const viewer = viewerFor(user);
  const rows = await submissionsFor(viewer, { uid: user.uid, limit: 50 });


  return (
    <div className="space-y-5">
      <PageHeader
        title="我的提交"
        actions={<NavigationLinks viewer={viewer} location="submissions" />}
      />

      {rows.length === 0 ? (
        <EmptyState>还没有提交记录。</EmptyState>
      ) : (
        <TableFrame>
          <table className="min-w-[560px]">
            <thead>
              <tr>
                <th>时间</th>
                <th>题目</th>
                <th>结果</th>
                <th className="text-right">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="text-fg-muted font-mono text-xs whitespace-nowrap tabular-nums">
                    {formatter.format(new Date(row.createdAt))}
                  </td>
                  <td>
                    <ProblemRef
                      contestSlug={row.contestSlug}
                      slug={row.problemSlug}
                      fallbackTitle={row.problemTitle}
                      className="text-fg font-medium"
                    />
                  </td>
                  <td>
                    <span className="flex flex-wrap items-center gap-2">
                      <VerdictBadge submission={row} />
                      <QueueBadge queue={row.queue} showJudge />
                    </span>
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/submissions/${row.id}`}
                      className="text-fg-muted hover:text-fg text-xs underline-offset-2 transition-colors hover:underline"
                    >
                      详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}

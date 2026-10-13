import { notFound } from "next/navigation";
import Link from "next/link";
import { getViewer } from "@/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { ProblemCreateForm } from "@/components/admin/problem-create-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { authorize } from "@/lib/authz/engine";
import { authoredProblems } from "@/lib/problems/authoring";
import { dateFormatter } from "@/lib/format";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

/**
 * The problems this deployment authored, drafts included.
 *
 * Repository problems are not listed: they are files, they are edited as files,
 * and a console that offered to edit them would be offering something it cannot
 * do. This page is about what was written here.
 */
export async function AdminProblemsView() {
  const viewer = await getViewer();
  if (!authorize("problem.author", null, viewer).allow) notFound();

  const rows = await authoredProblems();

  return (
    <div className="space-y-4">
      <AdminNav />
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>题目</span>
      </nav>

      <h1 className="text-fg text-xl font-bold">题目</h1>

      <Card>
        <CardHeader title="新建题目" />
        <CardBody>
          <ProblemCreateForm />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-fg-muted text-sm leading-6">这里还没有题目。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg-muted text-xs">
                    <th className="border-fg border-b px-3 py-2 text-left font-medium">题目</th>
                    <th className="border-fg border-b px-3 py-2 text-left font-medium">状态</th>
                    <th className="border-fg border-b px-3 py-2 text-left font-medium">文件</th>
                    <th className="border-fg border-b px-3 py-2 text-left font-medium">比赛</th>
                    <th className="border-border border-b px-3 py-2 text-left font-medium">改动</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {rows.map((row) => (
                    <tr key={row.slug}>
                      <td className="px-3 py-2 align-top">
                        <Link
                          href={`/admin/problems/${row.slug}`}
                          className="text-fg decoration-border-strong hover:decoration-fg font-semibold underline underline-offset-2"
                        >
                          {row.title}
                        </Link>
                        <div className="text-fg-subtle font-mono text-xs">{row.slug}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Badge tone={row.status === "published" ? "ok" : "neutral"}>
                          {row.status === "published" ? "已发布" : "草稿"}
                        </Badge>
                      </td>
                      <td className="text-fg-muted px-3 py-2 align-top tabular-nums">
                        {row.files}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {row.contests.length === 0 ? (
                          <span className="text-warn text-xs">未归属</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {row.contests.map((slug) => (
                              <Badge key={slug} mono>
                                {slug}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="text-fg-subtle px-3 py-2 align-top font-mono text-xs">
                        {row.updatedAt ? formatter.format(row.updatedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

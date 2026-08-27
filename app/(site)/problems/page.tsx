import Link from "next/link";
import type { Metadata } from "next";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { Badge } from "@/components/ui/badge";
import { problemsFor } from "@/lib/problems/access";

export const metadata: Metadata = { title: "题库" };

export const dynamic = "force-dynamic";

export default async function ProblemsPage() {
  const problems = problemsFor(await getViewer());

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

              <th className="border-border border-b px-4 py-2.5 text-left font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {problems.map(({ config: problem, gate }) => (
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
                  {gate.visible ? null : (
                    <Badge tone="warn" className="ml-2">
                      未公开
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ProblemBadgesSlot config={problem} />
                  </div>
                </td>
              </tr>
            ))}
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

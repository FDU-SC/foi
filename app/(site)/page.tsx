import Link from "next/link";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { problemsFor } from "@/lib/problems/access";

const ENTRIES = [
  {
    href: "/problems",
    title: "题库",
    description: "浏览全部题目，随时提交练习。",
  },
  {
    href: "/contests",
    title: "比赛",
    description: "查看进行中与已结束的比赛及其排行榜。",
  },
  {
    href: "/submissions",
    title: "提交记录",
    description: "追踪自己的评测结果与得分明细。",
  },
] as const;

// Which problems are listed depends on the clock and on who is asking.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const problems = problemsFor(await getViewer());

  return (
    <div className="space-y-12">
      <section className="pt-6">
        <h1 className="text-fg text-3xl font-bold tracking-tight">FOI</h1>
        <p className="text-fg-muted mt-3 max-w-2xl leading-7">
          一个可插拔的竞赛平台。题面、评测机与赛制计分都以代码形式存放在仓库中，
          可以像写组件一样定制每一道题的页面。
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {ENTRIES.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="border-border bg-surface hover:border-primary/50 hover:bg-surface-2 group rounded-lg border p-4 transition-colors"
          >
            <div className="text-fg group-hover:text-primary font-semibold transition-colors">
              {entry.title}
            </div>
            <p className="text-fg-muted mt-1.5 text-sm leading-6">
              {entry.description}
            </p>
          </Link>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-fg text-lg font-semibold">最新题目</h2>
          <Link
            href="/problems"
            className="text-fg-subtle hover:text-primary text-sm transition-colors"
          >
            查看全部
          </Link>
        </div>
        <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
          {problems.slice(0, 5).map(({ config: problem, gate }) => (
            <li key={problem.slug}>
              <Link
                href={`/problems/${problem.slug}`}
                className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3 transition-colors"
              >
                <span className="text-fg-subtle w-32 shrink-0 truncate font-mono text-xs">
                  {problem.slug}
                </span>
                <span className="text-fg flex-1 truncate text-sm font-medium">
                  {problem.title}
                </span>
                {gate.visible ? null : <Badge tone="warn">未公开</Badge>}
                {problem.difficulty ? (
                  <Badge tone="primary">{problem.difficulty}</Badge>
                ) : null}
              </Link>
            </li>
          ))}
          {problems.length === 0 ? (
            <li className="text-fg-subtle px-4 py-8 text-center text-sm">
              还没有题目。在 content/problems 下新建一个目录即可。
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

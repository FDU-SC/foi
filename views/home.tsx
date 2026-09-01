import Link from "next/link";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { HomeHero } from "@/components/site/home-hero";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { problemsFor } from "@/lib/problems/access";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export async function HomeView() {
  const problems = problemsFor(await getViewer());

  return (
    <div className="space-y-12">
      <HomeHero />

      <section className="grid gap-3 sm:grid-cols-3">
        {(site.homeEntries ?? []).map((entry, index) => (
          <Link
            key={entry.href}
            href={entry.href}
            style={revealDelay(index)}
            className={cn(
              "border-border bg-surface hover:border-primary/50 hover:bg-surface-2 group rounded-lg border p-4",
              "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out",
              "motion-safe:hover:-translate-y-0.5 hover:shadow-md",
              revealClass,
            )}
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
          {problems.slice(0, 5).map(({ config: problem, preview }, index) => (
            <li
              key={problem.slug}
              style={revealDelay(index)}
              className={revealClass}
            >
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
                {preview ? <Badge tone="warn">未公开</Badge> : null}
                <ProblemBadgesSlot config={problem} />
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

import Link from "next/link";
import { getViewer } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { HomeHero } from "@/components/site/home-hero";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { recentProblemsFor } from "@/lib/problems/access";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Lines the hero reveals before the page hands off to the entry cards. */
const HERO_LINES = 3;

/** How much of the catalogue the home page teases. */
const RECENT_COUNT = 5;

export async function HomeView() {
  const problems = recentProblemsFor(await getViewer(), RECENT_COUNT);

  return (
    <div className="space-y-12">
      <HomeHero />

      <section className="grid gap-3 sm:grid-cols-3">
        {(site.homeEntries ?? []).map((entry, index) => (
          <Link
            key={entry.href}
            href={entry.href}
            // Picks up where the hero's three lines left off, so the page
            // arrives as one cascade rather than two overlapping ones.
            style={revealDelay(index + HERO_LINES)}
            className={cn(
              "ui-lift border-border bg-surface/80 hover:border-primary/40 hover:bg-surface group rounded-xl border p-5",
              "shadow-[0_1px_0_oklch(100%_0_0/0.04)] hover:shadow-[0_16px_40px_-24px_var(--primary)]",
              revealClass,
            )}
          >
            <div className="text-fg group-hover:text-primary flex items-center gap-1.5 font-semibold transition-colors">
              {entry.title}
              <span
                aria-hidden
                className="text-primary -translate-x-1 opacity-0 transition-[transform,opacity] duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100"
              >
                →
              </span>
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
        <ul className="border-border divide-border bg-surface/70 divide-y overflow-hidden rounded-xl border backdrop-blur-sm">
          {problems.map(({ config: problem, preview }, index) => (
            <li
              key={problem.slug}
              style={revealDelay(index)}
              className={revealClass}
            >
              <Link
                href={`/problems/${problem.slug}`}
                className="hover:bg-surface-2/80 flex items-center gap-3 px-4 py-3 shadow-[inset_3px_0_0_0_transparent] transition-[background-color,box-shadow] duration-200 hover:shadow-[inset_3px_0_0_0_var(--primary)]"
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

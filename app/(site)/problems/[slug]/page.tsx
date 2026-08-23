import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/auth";
import { ProblemProvider } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { getContest } from "@/lib/contests/registry";
import { contestPhase } from "@/lib/contests/types";
import {
  getProblem,
  listProblems,
  loadStatement,
} from "@/lib/problems/registry";
import { toPublicConfig } from "@/lib/problems/types";

export const dynamicParams = false;

export function generateStaticParams() {
  return listProblems({ includeHidden: true }).map((problem) => ({
    slug: problem.slug,
  }));
}

export async function generateMetadata({
  params,
}: PageProps<"/problems/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: getProblem(slug)?.title ?? "题目" };
}

/**
 * Resolves `?contest=<slug>`, but only if the problem is actually part of that
 * contest and the contest is running. Without both checks a player could
 * attribute a submission to any contest they like. The API re-derives the same
 * two facts, since this only decides what the page shows.
 */
function resolveContest(
  raw: string | string[] | undefined,
  problemSlug: string,
): { title: string; slug: string } | null {
  if (typeof raw !== "string") return null;

  const contest = getContest(raw);
  if (!contest) return null;
  if (contestPhase(contest) !== "running") return null;
  if (!contest.problems.some((entry) => entry.slug === problemSlug)) return null;

  return { title: contest.title, slug: contest.slug };
}

export default async function ProblemPage({
  params,
  searchParams,
}: PageProps<"/problems/[slug]">) {
  const { slug } = await params;
  const config = getProblem(slug);
  if (!config) notFound();

  const Statement = await loadStatement(slug);
  if (!Statement) notFound();

  const user = await getSessionUser();
  const contest = resolveContest((await searchParams).contest, slug);

  return (
    <ProblemProvider
      value={{
        config: toPublicConfig(config),
        contestSlug: contest?.slug ?? null,
        canSubmit: Boolean(user),
      }}
    >
      <article className="mx-auto max-w-3xl">
        <nav className="text-fg-subtle mb-4 flex items-center gap-1.5 text-xs">
          {contest ? (
            <>
              <Link
                href={`/contests/${contest.slug}`}
                className="hover:text-fg transition-colors"
              >
                {contest.title}
              </Link>
              <span>/</span>
            </>
          ) : (
            <>
              <Link href="/problems" className="hover:text-fg transition-colors">
                题库
              </Link>
              <span>/</span>
            </>
          )}
          <span className="font-mono">{config.slug}</span>
          {contest ? (
            <Badge tone="ok" className="ml-1">
              比赛中
            </Badge>
          ) : null}
        </nav>

        <header className="border-border mb-6 border-b pb-5">
          <h1 className="text-fg text-2xl font-bold tracking-tight">
            {config.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {config.difficulty ? (
              <Badge tone="primary">{config.difficulty}</Badge>
            ) : null}
            {config.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
            <span className="text-fg-subtle ml-auto font-mono text-xs tabular-nums">
              满分 {config.maxScore}
            </span>
          </div>
        </header>

        <Statement />
      </article>
    </ProblemProvider>
  );
}

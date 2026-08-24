import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { ProblemProvider } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import type { ResolvedUser } from "@/lib/accounts/types";
import { describeAudience } from "@/lib/auth/audience";
import { viewerFor, type Viewer } from "@/lib/auth/viewer";
import { contestFor } from "@/lib/contests/access";
import { canEnterContest } from "@/lib/contests/queries";
import { contestPhase } from "@/lib/contests/types";
import { loadStatement, problemFor } from "@/lib/problems/access";
import { allProblems } from "@/lib/problems/registry";
import { toPublicConfig } from "@/lib/problems/types";

export const dynamicParams = false;

/**
 * The gate below is evaluated per request, which only works while this page
 * renders per request. It already does — it reads the session — but that is a
 * side effect of one call, and removing that call would silently turn the page
 * static and the gate off, with nothing failing to say so. Pinning it here
 * costs nothing and states the dependency.
 */
export const dynamic = "force-dynamic";

const gateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Raw on purpose: this decides which slugs route at all, not what anybody may
 * read. Gating here would make an embargoed problem 404 for its own author
 * too, and the gate below already answers the question that matters.
 */
export function generateStaticParams() {
  return allProblems().map((problem) => ({ slug: problem.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/problems/[slug]">): Promise<Metadata> {
  const { slug } = await params;

  // Goes through the same accessor as the body, so a gated title cannot leak
  // through `<title>` — the page body is not the only thing that says what a
  // round contains.
  const view = problemFor(slug, viewerFor(await getResolvedUser()));
  return { title: view?.config.title ?? "题目" };
}

/**
 * Resolves `?contest=<slug>`, but only if the problem is part of that contest,
 * the contest is running, and this person is entitled to enter it. Without all
 * three a player could attribute a submission to any contest they like.
 *
 * Somebody outside the entry rule is not turned away — they get the problem
 * without the contest context, so their submission counts as practice. The API
 * re-derives the same facts and answers 403 there, since a request that names
 * a contest explicitly is asking for something this page never offered.
 */
function resolveContest(
  raw: string | string[] | undefined,
  problemSlug: string,
  user: ResolvedUser | null,
  viewer: Viewer,
): { title: string; slug: string } | null {
  if (typeof raw !== "string") return null;

  const view = contestFor(raw, viewer);
  if (!view) return null;

  const contest = view.config;
  if (contestPhase(contest) !== "running") return null;
  if (!contest.problems.some((entry) => entry.slug === problemSlug)) return null;
  if (!user || !canEnterContest(contest, user)) return null;

  return { title: contest.title, slug: contest.slug };
}

export default async function ProblemPage({
  params,
  searchParams,
}: PageProps<"/problems/[slug]">) {
  const { slug } = await params;
  const user = await getResolvedUser();
  const viewer = viewerFor(user);

  // Undefined covers both "no such problem" and "not yours to see", and 404 is
  // the right answer to both: confirming that a slug exists but is embargoed
  // tells a player how many problems the round has and what they are called.
  const view = problemFor(slug, viewer);
  if (!view) notFound();

  const { config, gate } = view;
  const Statement = await loadStatement(slug);
  if (!Statement) notFound();

  const contest = resolveContest(
    (await searchParams).contest,
    slug,
    user,
    viewer,
  );

  return (
    <ProblemProvider
      value={{
        config: toPublicConfig(config),
        contestSlug: contest?.slug ?? null,
        // A preview holder reads the statement but still cannot submit; the
        // problem is not open, and who is looking does not change that.
        canSubmit: Boolean(user) && gate.visible,
      }}
    >
      <article className="mx-auto max-w-3xl">
        {!gate.visible ? (
          <div className="border-warn/40 bg-warn/10 mb-4 rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">预览</Badge>
              <span className="text-fg text-sm font-medium">
                这道题目尚未对选手公开
              </span>
            </div>
            <p className="text-fg-muted mt-1.5 text-xs leading-5">
              {gate.reason === "embargo"
                ? `将在比赛「${gate.contestSlug}」于 ${gateFormatter.format(gate.opensAt)} 开始时自动公开，无需重新部署。`
                : `题目的 visibleTo 是 ${describeAudience(gate.audience)}，你不在其中。`}
              目前只有具备 problem.viewAll 能力的人能看到本页，提交也已停用。
            </p>
          </div>
        ) : null}

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

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemProvider } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { authorize } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import {
  catalogueHref,
  contestHref,
  isCatalogue,
} from "@/lib/contests/catalogue";
import { contestProblemRefs } from "@/lib/contests/refs";
import {
  contestStatus,
  hasContestStarted,
  showsStatements,
} from "@/lib/contests/types";
import { loadStatement, problemFor } from "@/lib/problems/access";
import { dateFormatter } from "@/lib/format";
import { toPublicConfig } from "@/lib/problems/types";

const gateFormatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

type Props = PageProps<"/contests/[slug]/problems/[problem]">;
type CatalogueProps = PageProps<"/problems/[section]/[problem]">;

/**
 * Every pair except the catalogued ones. Those answer under `/problems`, and
 * the route has `dynamicParams = false`, so leaving them out is what keeps a
 * pair from having two URLs.
 */
export function problemDetailParams() {
  return contestProblemRefs()
    .filter((ref) => !isCatalogue(ref.contest.slug))
    .map((ref) => ({ slug: ref.contest.slug, problem: ref.problem.slug }));
}

/** The catalogued pairs, addressed by section and problem. */
export function cataloguedProblemParams() {
  return contestProblemRefs()
    .filter((ref) => isCatalogue(ref.contest.slug))
    .map((ref) => ({ section: ref.contest.slug, problem: ref.problem.slug }));
}

async function titleOf(
  contestSlug: string,
  problemSlug: string,
): Promise<Metadata> {
  const view = problemFor(
    contestSlug,
    problemSlug,
    viewerFor(await getResolvedUser()),
  );
  return { title: view?.ref.problem.title ?? "题目" };
}

export async function problemDetailMetadata({
  params,
}: Props): Promise<Metadata> {
  const { slug, problem } = await params;
  return titleOf(slug, problem);
}

export async function cataloguedProblemMetadata({
  params,
}: CatalogueProps): Promise<Metadata> {
  const { section, problem } = await params;
  return titleOf(section, problem);
}

export async function ProblemDetailView({ params }: Props) {
  const { slug, problem } = await params;
  return <ProblemDetail contestSlug={slug} problemSlug={problem} />;
}

export async function CataloguedProblemView({ params }: CatalogueProps) {
  const { section, problem } = await params;

  // The section segment is a contest slug, but only a catalogued one answers
  // here — otherwise the pair would hold a second URL beside its `/contests` one.
  if (!isCatalogue(section)) notFound();

  return <ProblemDetail contestSlug={section} problemSlug={problem} />;
}

async function ProblemDetail({
  contestSlug,
  problemSlug,
}: {
  contestSlug: string;
  problemSlug: string;
}) {
  const viewer = viewerFor(await getResolvedUser());

  const view = problemFor(contestSlug, problemSlug, viewer);
  if (!view) notFound();

  const { contest, entry, problem } = view.ref;
  const Statement = await loadStatement(problemSlug);
  if (!Statement) notFound();

  // The panel is enabled by the same question the submit endpoint will ask,
  // and when it refuses, it explains itself in the same words.
  const submittable = authorize("problem.submit", view.ref, viewer);
  const canAct = submittable.allow;

  const status = contestStatus(contest);

  // Preview means the audience policy did not let this person in, and there are
  // exactly three ways that happens. Naming the wrong one is worse than saying
  // nothing: "你不在其中" reads as a mistake to someone who is in the audience.
  const why = !hasContestStarted(contest)
    ? `将在比赛「${contest.title}」于 ${gateFormatter.format(contest.startsAt)} 开始时自动公开，无需重新部署。`
    : !showsStatements(contest)
      ? `比赛「${contest.title}」已经结束，并且不再公开它的题面。`
      : "你不在这场比赛的参赛范围内。";

  return (
    <ProblemProvider
      value={{
        config: toPublicConfig(problem),
        contestSlug: contest.slug,
        canAct,
        blocked: submittable.allow
          ? null
          : {
              code: submittable.reason.code,
              message: submittable.reason.message,
            },
      }}
    >
      <article className="mx-auto max-w-3xl">
        {view.preview ? (
          <div className="border-warn/40 bg-warn/10 mb-4 rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">预览</Badge>
              <span className="text-fg text-sm font-medium">
                这道题目尚未对选手公开
              </span>
            </div>
            <p className="text-fg-muted mt-1.5 text-xs leading-5">
              {why}
              {canAct
                ? null
                : "仅管理员可预览，提交暂未开放。"}
            </p>
          </div>
        ) : null}

        <nav className="text-fg-subtle mb-4 flex items-center gap-1.5 text-xs">
          {isCatalogue(contest.slug) ? (
            <>
              <Link
                href={catalogueHref()}
                className="hover:text-fg transition-colors"
              >
                题库
              </Link>
              <span>/</span>
            </>
          ) : null}
          <Link
            href={contestHref(contest.slug)}
            className="hover:text-fg transition-colors"
          >
            {contest.title}
          </Link>
          {entry.label ? (
            <>
              <span>/</span>
              <span className="font-mono">{entry.label}</span>
            </>
          ) : null}
          <Badge tone={status.tone} className="ml-1">
            {status.label}
          </Badge>
        </nav>

        <header className="border-border mb-6 border-b pb-5">
          <h1 className="text-fg text-2xl font-bold tracking-tight">
            {problem.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 empty:mt-0">
            <ProblemBadgesSlot config={problem} offered={contest.facets} />
          </div>
        </header>

        <Statement />
      </article>
    </ProblemProvider>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemProvider } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { permissionFor, type Permission } from "@/lib/authz/adapters";
import { viewerFor } from "@/lib/authz/viewer";
import {
  catalogueHref,
  contestHref,
  isCatalogue,
  standingsHref,
} from "@/lib/contests/catalogue";
import { contestProblemRefs } from "@/lib/contests/refs";
import {
  contestStatus,
  hasContestStarted,
  showsStatements,
} from "@/lib/contests/types";
import { loadStatement, problemFor } from "@/lib/problems/access";
import { invokeFor } from "@/lib/problems/actions";
import { dateFormatter } from "@/lib/format";
import { isInlineBackend, toPublicConfig } from "@/lib/problems/types";
import { submitFor } from "@/lib/submissions/gate";
import { cn } from "@/lib/utils";

const gateFormatter = dateFormatter({
  dateStyle: "medium",
  timeStyle: "short",
});

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
  return ProblemDetail({ contestSlug: slug, problemSlug: problem, embedded: true });
}

export async function CataloguedProblemView({ params }: CatalogueProps) {
  const { section, problem } = await params;

  // The section segment is a contest slug, but only a catalogued one answers
  // here — otherwise the pair would hold a second URL beside its `/contests` one.
  if (!isCatalogue(section)) notFound();

  return ProblemDetail({ contestSlug: section, problemSlug: problem });
}

async function ProblemDetail({
  contestSlug,
  problemSlug,
  embedded = false,
}: {
  contestSlug: string;
  problemSlug: string;
  embedded?: boolean;
}) {
  const viewer = viewerFor(await getResolvedUser());

  const now = new Date();
  const view = problemFor(contestSlug, problemSlug, viewer, now);
  if (!view) notFound();

  const { contest, entry, problem } = view.ref;
  const Statement = await loadStatement(problemSlug);
  if (!Statement) notFound();

  // The panel is enabled by the same question the submit endpoint will ask,
  // and when it refuses, it explains itself in the same words.
  const submittable = submitFor(contestSlug, problemSlug, viewer, now);
  const submit = permissionFor(submittable.ok ? null : submittable.denial);
  const declaredActions = isInlineBackend(problem.backend)
    ? []
    : Object.keys(problem.backend.actions);
  const actions: Partial<Record<string, Permission>> = Object.fromEntries(
    declaredActions.flatMap((action) => {
      const gate = invokeFor(contestSlug, problemSlug, action, viewer, now);
      if (gate.kind === "missing") return [];
      return [[action, permissionFor(gate.kind === "denied" ? gate.denial : null)]];
    }),
  );

  const status = contestStatus(contest, now);

  // Preview means the audience policy did not let this person in, and there are
  // exactly three ways that happens. Naming the wrong one is worse than saying
  // nothing: "你不在其中" reads as a mistake to someone who is in the audience.
  const why = !hasContestStarted(contest, now)
    ? `将于 ${gateFormatter.format(contest.startsAt)} 公开。`
    : !showsStatements(contest, now)
      ? "比赛已结束，题面不再公开。"
      : "你不在参赛范围内。";

  return (
    <ProblemProvider
      value={{
        config: toPublicConfig(problem),
        contestSlug: contest.slug,
        permissions: { submit, actions },
      }}
    >
      <article className="min-w-0">
        {view.preview ? (
          <div className="border-warn mb-4 flex flex-wrap items-center gap-2 border-l-2 py-1 pl-3">
            <Badge tone="warn">预览</Badge>
            <span className="text-fg text-sm">{why}</span>
          </div>
        ) : null}

        {!embedded ? (
          <nav className="text-fg-muted mb-5 flex flex-wrap items-center gap-1.5 text-xs">
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
        ) : null}

        <header className={cn("mb-4", embedded && "pt-2")}>
          <p className="text-fg-muted font-mono text-xs wrap-anywhere">{entry.label ?? problem.slug}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-fg min-w-0 text-[28px] leading-tight font-bold wrap-anywhere">
              {problem.title}
            </h1>
            {embedded ? <span className="text-fg-muted text-sm tabular-nums">{entry.points ?? problem.maxScore} 分</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 empty:mt-0">
            <ProblemBadgesSlot config={problem} offered={contest.facets} />
          </div>
        </header>

        <div
          className={embedded
            ? "min-w-0"
            : "grid items-start gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_240px]"}
        >
          {!embedded ? (
            <aside className="oj-sidebar lg:sticky lg:top-16 lg:col-start-2 lg:row-start-1 lg:pt-1">
              <h2 className="text-fg-muted text-xs">所属比赛</h2>
              <Link
                href={contestHref(contest.slug)}
                className="text-fg decoration-border-strong hover:decoration-fg mt-0.5 block text-sm font-semibold underline underline-offset-2"
              >
                {contest.title}
              </Link>
              <dl className="mt-3 grid-cols-2 lg:grid-cols-1">
                <div>
                  <dt>开始时间</dt>
                  <dd className="tabular-nums">{gateFormatter.format(contest.startsAt)}</dd>
                </div>
                <div>
                  <dt>结束时间</dt>
                  <dd className="tabular-nums">{gateFormatter.format(contest.endsAt)}</dd>
                </div>
              </dl>
              <nav
                aria-label="题目相关页面"
                className="border-border mt-4 flex gap-4 border-t pt-3 text-sm lg:flex-col lg:gap-1.5"
              >
                <Link
                  className="text-fg underline-offset-2 hover:underline"
                  href={contestHref(contest.slug)}
                >
                  返回题单
                </Link>
                <Link
                  className="text-fg underline-offset-2 hover:underline"
                  href={standingsHref(contest.slug)}
                >
                  排行榜
                </Link>
              </nav>
            </aside>
          ) : null}
          <div className="oj-statement lg:col-start-1 lg:row-start-1">
            <Statement />
          </div>
        </div>
      </article>
    </ProblemProvider>
  );
}

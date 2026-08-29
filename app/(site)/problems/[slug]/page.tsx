import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemProvider } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { describeAudience } from "@/lib/authz/audience";
import { authorize } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { contestEntryFor } from "@/lib/contests/access";
import { loadStatement, problemFor } from "@/lib/problems/access";
import { dateFormatter } from "@/lib/format";
import { allProblems } from "@/lib/problems/registry";
import { toPublicConfig } from "@/lib/problems/types";

export const dynamicParams = false;

export const dynamic = "force-dynamic";

const gateFormatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

export function generateStaticParams() {
  return allProblems().map((problem) => ({ slug: problem.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/problems/[slug]">): Promise<Metadata> {
  const { slug } = await params;

  const view = problemFor(slug, viewerFor(await getResolvedUser()));
  return { title: view?.config.title ?? "题目" };
}

export default async function ProblemPage({
  params,
  searchParams,
}: PageProps<"/problems/[slug]">) {
  const { slug } = await params;
  const user = await getResolvedUser();
  const viewer = viewerFor(user);

  const view = problemFor(slug, viewer);
  if (!view) notFound();

  const { config } = view;
  const Statement = await loadStatement(slug);
  if (!Statement) notFound();

  const requested = (await searchParams).contest;
  const round =
    typeof requested === "string"
      ? contestEntryFor(requested, slug, viewer)
      : null;
  const contest = round?.ok ? round.contest : null;

  // The panel is enabled by the same question the submit endpoint will ask,
  // and when it refuses, it explains itself in the same words.
  const submittable = authorize("problem.submit", config, viewer, { contest });
  const canAct = submittable.allow;

  return (
    <ProblemProvider
      value={{
        config: toPublicConfig(config),
        contestSlug: contest?.slug ?? null,
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
        {config.retired ? (
          <div className="border-border bg-surface-2 mb-4 rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>已下架</Badge>
              <span className="text-fg text-sm font-medium">
                这道题目不再接受提交
              </span>
            </div>
            <p className="text-fg-muted mt-1.5 text-xs leading-5">
              题面与历史提交都还在，做过它的人可以照常回看；它只是从题库里退了出去。
            </p>
          </div>
        ) : null}

        {view.preview ? (
          <div className="border-warn/40 bg-warn/10 mb-4 rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">预览</Badge>
              <span className="text-fg text-sm font-medium">
                这道题目尚未对选手公开
              </span>
            </div>
            <p className="text-fg-muted mt-1.5 text-xs leading-5">
              {view.embargo
                ? `将在比赛「${view.embargo.contestSlug}」于 ${gateFormatter.format(view.embargo.opensAt)} 开始时自动公开，无需重新部署。`
                : `题目的 visibleTo 是 ${describeAudience(config.visibleTo)}，你不在其中。`}
              {canAct
                ? null
                : "目前只有能预览未公开内容的人看得到本页，提交也已停用。"}
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
          <div className="mt-3 flex flex-wrap items-center gap-2 empty:mt-0">
            <ProblemBadgesSlot config={config} />
          </div>
        </header>

        <Statement />
      </article>
    </ProblemProvider>
  );
}

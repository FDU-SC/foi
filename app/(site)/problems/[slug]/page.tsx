import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResolvedUser } from "@/auth";
import { ProblemBadgesSlot } from "@/components/problem/badges-slot";
import { ProblemProvider } from "@/components/problem/problem-context";
import { Badge } from "@/components/ui/badge";
import { describeAudience } from "@/lib/permissions/audience";
import { viewerFor } from "@/lib/permissions/viewer";
import { contestEntryFor } from "@/lib/contests/access";
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

  // `?contest=` is the client's claim and every fact behind it is re-derived,
  // by the same function the submission gate and the action route use. Somebody
  // outside the entry rule is not turned away — they lose the contest context
  // and their submission counts as practice, which is what `null` means to the
  // panel below.
  const requested = (await searchParams).contest;
  const round =
    typeof requested === "string"
      ? contestEntryFor(requested, slug, user)
      : null;
  const contest = round?.ok ? round.contest : null;

  return (
    <ProblemProvider
      value={{
        config: toPublicConfig(config),
        contestSlug: contest?.slug ?? null,
        // A preview holder reads the statement but still cannot submit, and
        // neither can anybody on a retired problem. Who is looking does not
        // change either answer, which is why both live in `open`.
        canAct: Boolean(user) && view.open,
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

        {/* Two overrides reach a statement the gate refused, and they are
            different situations to be in: a proofreader is reading something
            not released yet, while somebody here through a round is reading
            something released to other people and not to them. Which one it
            was is `reachedVia`'s answer, asked at the gate rather than by
            re-deriving the capability here. Both end the same way — the submit
            box below is disabled — and without a notice that reads as broken. */}
        {!gate.visible && view.reachedVia === "problem.viewAll" ? (
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

        {!gate.visible && view.reachedVia === "contest" ? (
          <div className="border-info/40 bg-info/10 mb-4 rounded-lg border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">经由比赛</Badge>
              <span className="text-fg text-sm font-medium">
                这道题目不对你开放，你是通过比赛权限读到它的
              </span>
            </div>
            {/* Always the `audience` reason here. An embargo means no round
                using this problem has started, and a started round is exactly
                what carried this viewer in. */}
            <p className="text-fg-muted mt-1.5 text-xs leading-5">
              {gate.reason === "audience"
                ? `题目的 visibleTo 是 ${describeAudience(gate.audience)}，你不在其中；`
                : null}
              你能打开本页，是因为你看得到引用它的某场已开赛比赛。题面照常可读，提交与交互操作都已停用。
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

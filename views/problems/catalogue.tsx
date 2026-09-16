import { NavigationLinks } from "@/components/site/navigation-links";
import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/page";
import type { Viewer } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueSlugs,
  contestHref,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import {
  contestPhase,
  contestStatus,
  type ContestConfig,
} from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { summarizeProgress } from "@/lib/problems/selection";
import { progressFor } from "@/lib/problems/progress";

const UNGROUPED = Symbol("ungrouped");
interface SectionCard {
  contest: ContestConfig;
  total: number;
  solved: number | null;
  preview: boolean;
  featuredProblems: { slug: string; title: string; preview: boolean }[];
}
interface Group {
  heading: string | null;
  cards: SectionCard[];
}

export function catalogueIndexMetadata(): Metadata {
  return { title: "题库" };
}

export async function CatalogueIndexView() {
  const viewer = await getViewer();
  const cards = (
    await Promise.all(catalogueSlugs().map((slug) => cardFor(slug, viewer)))
  ).flatMap((card) => card ?? []);
  const groups = groupByDomain(cards);
  return (
    <div className="space-y-5">
      <PageHeader
        title="题库"
        actions={<NavigationLinks viewer={viewer} location="catalogue" />}
      />
      {groups.length === 0 ? <EmptyState>题库还没有分区。</EmptyState> : null}
      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const only = group.cards.length === 1 ? group.cards[0] : null;
          return only ? (
            <FeaturedSection
              key={group.heading ?? "ungrouped"}
              card={only}
              heading={group.heading}
            />
          ) : (
            <section
              key={group.heading ?? "ungrouped"}
              className="ui-panel border-border bg-surface min-w-0 overflow-hidden rounded-xl border"
            >
              <header className="border-border bg-surface-2/60 flex items-center justify-between gap-3 border-b px-4 py-3.5">
                <h2 className="text-fg text-sm font-semibold">
                  {group.heading ?? "其他分区"}
                </h2>
                <span className="text-fg-subtle shrink-0 text-xs">
                  {group.cards.length} 个分区
                </span>
              </header>
              <ul className="divide-border/70 divide-y">
                {group.cards.map((card) => (
                  <SectionRow key={card.contest.slug} card={card} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SectionState({ card }: { card: SectionCard }) {
  const status =
    contestPhase(card.contest) === "running"
      ? null
      : contestStatus(card.contest);
  return (
    <>
      {card.preview ? <Badge tone="warn">未公开</Badge> : null}
      {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
    </>
  );
}

function SectionMeta({ card }: { card: SectionCard }) {
  return (
    <div className="text-fg-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-mono tabular-nums">
        {card.solved !== null
          ? `已通过 ${card.solved} / ${card.total}`
          : `${card.total} 题`}
      </span>
      <Link
        href={standingsHref(card.contest.slug)}
        aria-label={`${card.contest.title}排行榜`}
        className="hover:text-primary rounded-sm transition-colors hover:underline"
      >
        排行榜
      </Link>
    </div>
  );
}

function SectionRow({ card }: { card: SectionCard }) {
  return (
    <li className="catalogue-section hover:bg-surface-2/50 px-4 py-3 transition-colors">
      <Link
        href={contestHref(card.contest.slug)}
        className="group block min-w-0 rounded-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="catalogue-title text-fg group-hover:text-primary text-sm font-semibold transition-colors">
            {card.contest.title}
          </h3>
          <SectionState card={card} />
        </div>
        {card.contest.description ? (
          <p
            title={card.contest.description}
            className="text-fg-muted mt-1 line-clamp-2 text-xs leading-5"
          >
            {card.contest.description}
          </p>
        ) : null}
      </Link>
      <div className="mt-2">
        <SectionMeta card={card} />
      </div>
    </li>
  );
}

/** A single-section domain gets a full-width introduction and direct, gated problem links. */
function FeaturedSection({
  card,
  heading,
}: {
  card: SectionCard;
  heading: string | null;
}) {
  const { contest, featuredProblems } = card;
  return (
    <section className="catalogue-section ui-panel border-border bg-surface col-span-full grid min-w-0 gap-4 rounded-xl border p-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6 lg:p-5">
      <div className="min-w-0">
        {heading && heading !== contest.title ? (
          <p className="text-fg-subtle mb-1.5 text-xs">{heading}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={contestHref(contest.slug)} className="rounded-sm">
            <h2 className="catalogue-title text-fg text-base font-semibold">
              {contest.title}
            </h2>
          </Link>
          <SectionState card={card} />
        </div>
        {contest.description ? (
          <p className="text-fg-muted mt-1 text-xs leading-5">
            {contest.description}
          </p>
        ) : null}
        <div className="mt-2">
          <SectionMeta card={card} />
        </div>
      </div>
      {featuredProblems.length > 0 ? (
        <div className="border-border/70 min-w-0 border-t pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="text-fg-muted">题目直达</span>
            <Link
              href={contestHref(contest.slug)}
              className="text-fg-subtle hover:text-primary rounded-sm hover:underline"
            >
              全部题目 →
            </Link>
          </div>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {featuredProblems.map((problem) => (
              <li key={problem.slug}>
                <Link
                  href={problemHref(contest.slug, problem.slug)}
                  className="text-fg hover:text-primary hover:bg-primary-subtle/50 flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors"
                >
                  <span className="min-w-0">{problem.title}</span>
                  {problem.preview ? (
                    <Badge tone="warn">未公开</Badge>
                  ) : (
                    <span aria-hidden className="text-fg-subtle shrink-0">
                      ↗
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

async function cardFor(
  slug: string,
  viewer: Viewer,
): Promise<SectionCard | undefined> {
  // Through `contest.read`, the same gate the section page uses. Reading the
  // registry straight would show the title and description of a section whose
  // audience this viewer is not in.
  const view = contestFor(slug, viewer);
  if (!view) return undefined;

  const problems = problemsFor(slug, viewer);
  const card: SectionCard = {
    contest: view.config,
    total: problems.length,
    preview: view.preview,
    featuredProblems: problems.slice(0, 4).map(({ ref, preview }) => ({
      slug: ref.problem.slug,
      title: ref.problem.title,
      preview,
    })),
    solved: null,
  };

  const statuses = viewer.authenticated ? await progressFor(slug, viewer) : null;
  return { ...card, solved: summarizeProgress(problems, statuses).solved };
}

/** Headings in the order their first card appears, ungrouped cards last. */
function groupByDomain(cards: SectionCard[]): Group[] {
  const byHeading = new Map<string | typeof UNGROUPED, SectionCard[]>();

  for (const card of cards) {
    const key = card.contest.domain ?? UNGROUPED;
    const held = byHeading.get(key);
    if (held) held.push(card);
    else byHeading.set(key, [card]);
  }

  const ungrouped = byHeading.get(UNGROUPED);
  byHeading.delete(UNGROUPED);

  return [
    ...[...byHeading].map(([heading, within]) => ({
      heading: heading as string,
      cards: within,
    })),
    ...(ungrouped ? [{ heading: null, cards: ungrouped }] : []),
  ];
}

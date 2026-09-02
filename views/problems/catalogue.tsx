import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import type { Viewer } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { catalogueSlugs, contestHref } from "@/lib/contests/catalogue";
import {
  contestPhase,
  contestStatus,
  type ContestConfig,
} from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { computeProblemStatuses } from "@/lib/stats";
import { submissionsFor } from "@/lib/submissions/access";
import { cn } from "@/lib/utils";

/** How far back the progress count looks. Beyond this the oldest attempts drop out. */
const STATUS_DEPTH = 5000;

/** Cards with no heading of their own, gathered under one blank group. */
const UNGROUPED = Symbol("ungrouped");

export function catalogueIndexMetadata(): Metadata {
  return { title: "题库" };
}

interface SectionCard {
  contest: ContestConfig;
  total: number;
  solved: number | null;
  preview: boolean;
}

/**
 * The catalogue index: one card per catalogued contest, gathered under the
 * heading each one declares.
 *
 * Cards go through `contest.read`, the same gate the section page uses, so a
 * card here never leads to a refusal. Headings appear in the order their first
 * contest appears in `site.catalogue`, which is where the order is declared.
 */
export async function CatalogueIndexView() {
  const viewer = await getViewer();

  const cards = (
    await Promise.all(
      catalogueSlugs().map((slug) => cardFor(slug, viewer)),
    )
  ).flatMap((card) => card ?? []);

  const groups = groupByDomain(cards);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-fg text-2xl font-bold tracking-tight">题库</h1>
        <p className="text-fg-muted leading-7">
          按方向分区，每个分区是一份长期开放的题单，各有各的排行榜。
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-xl border py-16 text-center text-sm">
          题库还没有分区。在 content/site.ts 的 catalogue 里点名几场比赛。
        </p>
      ) : null}

      {groups.map(({ heading, cards: within }, groupIndex) => (
        <section key={heading ?? "—"} className="space-y-3">
          {heading ? (
            <h2 className="text-fg-muted text-sm font-semibold tracking-wide">
              {heading}
            </h2>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {within.map((card, index) => (
              <SectionTile
                key={card.contest.slug}
                card={card}
                delay={groupIndex * 3 + index}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
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

  const card = {
    contest: view.config,
    total: problems.length,
    preview: view.preview,
  };

  if (!viewer.authenticated) return { ...card, solved: null };

  const statuses = computeProblemStatuses(
    await submissionsFor(viewer, { contestSlug: slug, limit: STATUS_DEPTH }),
  );

  return {
    ...card,
    solved: problems.filter(
      ({ ref }) => statuses.get(ref.problem.slug)?.accepted,
    ).length,
  };
}

/** Headings in the order their first card appears, ungrouped cards last. */
function groupByDomain(
  cards: SectionCard[],
): { heading: string | null; cards: SectionCard[] }[] {
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

function SectionTile({ card, delay }: { card: SectionCard; delay: number }) {
  const { contest, total, solved, preview } = card;

  // A catalogue section's normal state is open, and saying so on every card is
  // noise. Anything else changes what a visitor can do there, so it gets a badge.
  const status = contestPhase(contest) === "running" ? null : contestStatus(contest);

  return (
    <Link
      href={contestHref(contest.slug)}
      style={revealDelay(delay)}
      className={cn("group block rounded-xl", revealClass)}
    >
      <Card className="hover:border-border-strong h-full transition-colors">
        <div className="flex h-full flex-col gap-2 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-fg group-hover:text-primary font-semibold transition-colors">
              {contest.title}
            </h3>
            {preview ? <Badge tone="warn">未公开</Badge> : null}
            {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
          </div>

          {contest.description ? (
            <p className="text-fg-muted line-clamp-2 text-sm leading-6">
              {contest.description}
            </p>
          ) : null}

          <div className="text-fg-subtle mt-auto flex items-baseline gap-2 pt-1 font-mono text-xs tabular-nums">
            {solved === null ? (
              <span>{total} 题</span>
            ) : (
              <span>
                {solved} / {total} 题
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

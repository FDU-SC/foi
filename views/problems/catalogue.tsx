import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import type { Viewer } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueSlugs,
  contestHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import {
  contestPhase,
  contestStatus,
  type ContestConfig,
} from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { collectFacets } from "@/lib/problems/facets";
import { computeProblemStatuses } from "@/lib/stats";
import { submissionsFor } from "@/lib/submissions/access";
import { cn } from "@/lib/utils";

/** How far back the progress count looks. Beyond this the oldest attempts drop out. */
const STATUS_DEPTH = 5000;

/** Problem titles shown on a section card before the remainder is counted. */
const PREVIEW = 4;

/** Facet values a card will render; the rest collapse into "+N". */
const CHIP_CAP = 8;

/** Lines the header reveals before the page hands off to the section cards. */
const HEADER_LINES = 3;

/** Cards with no heading of their own, gathered under one blank group. */
const UNGROUPED = Symbol("ungrouped");

const LIFT = [
  "ui-lift border-border bg-surface/80 hover:border-primary/40 hover:bg-surface rounded-xl border",
  "shadow-[0_1px_0_oklch(100%_0_0/0.04)] hover:shadow-[0_16px_40px_-24px_var(--primary)]",
].join(" ");

export function catalogueIndexMetadata(): Metadata {
  return { title: "题库" };
}

interface ListedProblem {
  label: string;
  title: string;
}

interface SectionCard {
  contest: ContestConfig;
  total: number;
  solved: number | null;
  preview: boolean;
  listed: ListedProblem[];
  chips: string[];
  extraChips: number;
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
    <div className="space-y-10">
      <header className="space-y-0">
        <p
          style={revealDelay(0)}
          className={cn(
            "text-primary mb-4 font-mono text-[11px] font-medium tracking-[0.32em] uppercase",
            revealClass,
          )}
        >
          按方向分区
        </p>
        <h1
          style={revealDelay(1)}
          className={cn(
            "text-fg text-4xl font-bold tracking-tight sm:text-5xl",
            revealClass,
          )}
        >
          题库
        </h1>
        <p
          style={revealDelay(2)}
          className={cn(
            "text-fg-muted mt-4 max-w-2xl leading-7",
            revealClass,
          )}
        >
          每个分区是一份长期开放的题单，各有各的排行榜。
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-xl border py-16 text-center text-sm">
          题库还没有分区。在 content/site.ts 的 catalogue 里点名几场比赛。
        </p>
      ) : null}

      {groups.map(({ heading, cards: within }, groupIndex) => (
        <section key={heading ?? "—"} className="space-y-4">
          {heading ? (
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-fg text-lg font-semibold tracking-tight">
                {heading}
              </h2>
              <span className="text-fg-subtle font-mono text-xs tabular-nums">
                {within.reduce((sum, card) => sum + card.total, 0)} 题
              </span>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {within.map((card, index) => (
              <SectionTile
                key={card.contest.slug}
                card={card}
                delay={HEADER_LINES + groupIndex * 2 + index}
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
  const values = collectFacets(
    problems.map(({ ref }) => ref.problem),
    view.config.facets,
  ).flatMap((group) => group.values);

  const card: SectionCard = {
    contest: view.config,
    total: problems.length,
    preview: view.preview,
    listed: problems.slice(0, PREVIEW).map(({ ref }) => ({
      label: ref.entry.label,
      title: ref.problem.title,
    })),
    chips: values.slice(0, CHIP_CAP),
    extraChips: Math.max(0, values.length - CHIP_CAP),
    solved: null,
  };

  if (!viewer.authenticated) return card;

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
  const { contest, total, solved, preview, listed, chips, extraChips } = card;

  // A catalogue section's normal state is open, and saying so on every card is
  // noise. Anything else changes what a visitor can do there, so it gets a badge.
  const status = contestPhase(contest) === "running" ? null : contestStatus(contest);
  const remaining = total - listed.length;

  return (
    <article
      style={revealDelay(delay)}
      className={cn("group flex h-full flex-col", LIFT, revealClass)}
    >
      <Link
        href={contestHref(contest.slug)}
        className="flex flex-1 flex-col gap-3 p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-fg group-hover:text-primary font-semibold transition-colors">
            {contest.title}
          </h3>
          <span
            aria-hidden
            className="text-primary -translate-x-1 opacity-0 transition-[transform,opacity] duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100"
          >
            →
          </span>
          {preview ? <Badge tone="warn">未公开</Badge> : null}
          {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </div>

        {contest.description ? (
          <p className="text-fg-muted line-clamp-2 text-sm leading-6">
            {contest.description}
          </p>
        ) : null}

        {listed.length > 0 ? (
          <ul className="space-y-1">
            {listed.map((problem) => (
              <li
                key={problem.label}
                className="flex items-baseline gap-2 text-sm"
              >
                <span className="text-fg-subtle shrink-0 font-mono text-xs">
                  {problem.label}
                </span>
                <span className="text-fg-muted truncate">{problem.title}</span>
              </li>
            ))}
            {remaining > 0 ? (
              <li className="text-fg-subtle text-xs">还有 {remaining} 题</li>
            ) : null}
          </ul>
        ) : null}

        {chips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((value) => (
              <Badge key={value} tone="neutral">
                {value}
              </Badge>
            ))}
            {extraChips > 0 ? (
              <span className="text-fg-subtle font-mono text-xs">
                +{extraChips}
              </span>
            ) : null}
          </div>
        ) : null}
      </Link>

      <div className="border-border mt-auto flex items-center gap-3 border-t px-5 py-3">
        {solved !== null && total > 0 ? (
          <>
            <div className="bg-primary-subtle h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${Math.round((solved / total) * 100)}%` }}
              />
            </div>
            <span className="text-fg-subtle shrink-0 font-mono text-xs tabular-nums">
              {solved} / {total}
            </span>
          </>
        ) : (
          <span className="text-fg-subtle font-mono text-xs tabular-nums">
            {total} 题
          </span>
        )}
        <Link
          href={standingsHref(contest.slug)}
          className="text-primary ml-auto shrink-0 text-xs hover:underline"
        >
          排行榜 →
        </Link>
      </div>
    </article>
  );
}

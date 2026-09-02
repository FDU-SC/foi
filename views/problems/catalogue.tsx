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
const PREVIEW = 6;

/** Facet values a card will render; the rest collapse into "+N". */
const CHIP_CAP = 6;

/** Lines the header reveals before the page hands off to the section cards. */
const HEADER_LINES = 2;

/** Cards with no heading of their own, gathered under one blank group. */
const UNGROUPED = Symbol("ungrouped");

const LIFT = [
  "ui-lift border-border bg-surface/80 hover:border-primary/40 hover:bg-surface rounded-xl border",
  "shadow-[0_1px_0_oklch(100%_0_0/0.04)] hover:shadow-[0_16px_40px_-24px_var(--primary)]",
].join(" ");

const PANE =
  "bg-surface/80 transition-colors hover:bg-surface";

const PANEL = [
  "border-border bg-border overflow-hidden rounded-xl border",
  "shadow-[0_1px_0_oklch(100%_0_0/0.04)]",
].join(" ");

export function catalogueIndexMetadata(): Metadata {
  return { title: "题库" };
}

interface ListedProblem {
  slug: string;
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

interface Group {
  heading: string | null;
  cards: SectionCard[];
}

/**
 * The catalogue index: catalogued contests, gathered under the heading each
 * one declares.
 *
 * Cards go through `contest.read`, the same gate the section page uses, so a
 * card here never leads to a refusal. Headings appear in the order their first
 * contest appears in `site.catalogue`, which is where the order is declared.
 *
 * Each heading is its own band. A heading with one section is a full-width
 * card that carries the heading inside; two or more sections share a paneled
 * window under that heading. Headings are never packed across domains.
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p
            style={revealDelay(0)}
            className={cn(
              "text-primary mb-2 font-mono text-[11px] font-medium tracking-[0.32em] uppercase",
              revealClass,
            )}
          >
            按方向分区
          </p>
          <h1
            style={revealDelay(1)}
            className={cn(
              "text-fg text-2xl font-bold tracking-tight",
              revealClass,
            )}
          >
            题库
          </h1>
        </div>
        <p
          style={revealDelay(1)}
          className={cn(
            "text-fg-muted max-w-md text-sm leading-6",
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

      {groups.map((group, groupIndex) => (
        <DomainView
          key={group.heading ?? "—"}
          group={group}
          delay={HEADER_LINES + offsetBefore(groups, groupIndex)}
        />
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
    listed: problems
      .slice(-PREVIEW)
      .toReversed()
      .map(({ ref }) => ({
        slug: ref.problem.slug,
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

function offsetBefore(groups: Group[], index: number): number {
  return groups.slice(0, index).reduce((sum, group) => sum + group.cards.length, 0);
}

function tileGridClass(count: number): string {
  if (count === 3) return "grid grid-cols-1 gap-px sm:grid-cols-3";
  if (count === 6 || count === 9) {
    return "grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-3";
  }
  return "grid grid-cols-1 gap-px sm:grid-cols-2";
}

function tileColumns(count: number): number {
  return count === 3 || count === 6 || count === 9 ? 3 : 2;
}

/** The leftover cell in a paneled grid stretches rather than leaving a hole. */
function spanRestClass(count: number): string {
  if (count === 6 || count === 9) return "sm:col-span-2 lg:col-span-3";
  if (tileColumns(count) === 3) return "sm:col-span-3";
  return "sm:col-span-2";
}

function DomainView({ group, delay }: { group: Group; delay: number }) {
  const [only] = group.cards;
  if (group.cards.length === 1 && only) {
    return (
      <SectionTile
        card={only}
        heading={group.heading}
        delay={delay}
        variant="lift"
        layout="wide"
      />
    );
  }

  return (
    <ClusterView
      heading={group.heading}
      cards={group.cards}
      delay={delay}
    />
  );
}

function ClusterView({
  heading,
  cards,
  delay,
}: {
  heading: string | null;
  cards: SectionCard[];
  delay: number;
}) {
  const total = cards.reduce((sum, card) => sum + card.total, 0);
  const columns = tileColumns(cards.length);

  return (
    <section className="space-y-3">
      {heading ? (
        <div
          style={revealDelay(delay)}
          className={cn(
            "flex items-baseline justify-between gap-3",
            revealClass,
          )}
        >
          <h2 className="text-fg text-[15px] font-semibold tracking-tight">
            {heading}
          </h2>
          <span className="text-fg-subtle font-mono text-xs tabular-nums">
            {total} 题
          </span>
        </div>
      ) : null}

      <div className={PANEL}>
        <div className={tileGridClass(cards.length)}>
          {cards.map((card, index) => (
            <SectionTile
              key={card.contest.slug}
              card={card}
              delay={delay + 1 + index}
              variant="pane"
              layout={
                index === cards.length - 1 && cards.length % columns !== 0
                  ? "wide"
                  : "cell"
              }
              spanRest={
                index === cards.length - 1 && cards.length % columns !== 0
                  ? spanRestClass(cards.length)
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionTile({
  card,
  delay,
  heading,
  variant,
  layout,
  spanRest,
}: {
  card: SectionCard;
  delay: number;
  heading?: string | null;
  variant: "lift" | "pane";
  layout: "cell" | "wide";
  spanRest?: string;
}) {
  const { contest, total, solved, preview, listed, chips, extraChips } = card;

  // A catalogue section's normal state is open, and saying so on every card is
  // noise. Anything else changes what a visitor can do there, so it gets a badge.
  const status = contestPhase(contest) === "running" ? null : contestStatus(contest);
  const remaining = total - listed.length;
  const eyebrow = heading && heading !== contest.title ? heading : null;
  const wide = layout === "wide";
  const split = listed.length > 0 || chips.length > 0;

  return (
    <article
      style={revealDelay(delay)}
      className={cn(
        "group flex h-full min-w-0 flex-col",
        variant === "lift" ? LIFT : PANE,
        spanRest,
        revealClass,
      )}
    >
      <Link
        href={contestHref(contest.slug)}
        className={cn(
          "grid grid-cols-1 content-start items-start gap-3 p-4",
          split && "sm:grid-cols-[minmax(8rem,0.42fr)_minmax(0,1fr)] sm:gap-5",
          split &&
            wide &&
            "sm:grid-cols-[minmax(10rem,0.34fr)_minmax(0,1fr)] sm:gap-8",
          wide && "sm:p-5",
        )}
      >
        <div className="min-w-0 space-y-2">
          {eyebrow ? (
            <p className="text-primary font-mono text-[11px] font-medium tracking-[0.28em]">
              {eyebrow}
            </p>
          ) : null}

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
            <p className="text-fg-muted text-sm leading-6">
              {contest.description}
            </p>
          ) : null}
        </div>

        {listed.length > 0 || chips.length > 0 ? (
          <div className="min-w-0 space-y-2.5">
            {listed.length > 0 ? (
              <ul
                className={cn(
                  "bg-surface-2/90 border-border/70 grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5",
                  wide && listed.length >= 3 && "sm:grid-cols-2",
                )}
              >
                {listed.map((problem) => (
                  <li key={problem.slug} className="min-w-0">
                    <span className="text-fg block truncate text-sm font-medium">
                      {problem.title}
                    </span>
                    <span className="text-fg-subtle block truncate font-mono text-[11px]">
                      {problem.slug}
                    </span>
                  </li>
                ))}
                {remaining > 0 ? (
                  <li className="text-fg-subtle self-end text-xs">
                    还有 {remaining} 题
                  </li>
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
          </div>
        ) : null}
      </Link>

      <div
        className={cn(
          "border-border mt-auto flex items-center gap-3 border-t px-4 py-2.5",
          wide && "px-5",
        )}
      >
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
            {total === 0 ? "暂无题目" : `${total} 题`}
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

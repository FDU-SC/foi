"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";
import { CatalogueTabs } from "@/components/problem/catalogue-tabs";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ListNav, type ListNavEntry, type ListNavGroup } from "@/components/ui/list-nav";
import {
  boardScopeOf,
  boardScopeQuery,
  catalogueScopeOf,
  directionsOf,
  gathers,
  sameBoardScope,
  type CatalogueScope,
} from "@/lib/contests/scope";
import {
  catalogueBoardSections,
  catalogueHref,
  contestHref,
  leaderboardHref,
} from "@/lib/contests/catalogue";
import { readDay } from "@/lib/calendar-day";
import { PAGE_PARAM } from "@/lib/paging";
import { queryString, without, type SearchParams } from "@/lib/query";
import { STANDINGS_PARAMS } from "@/lib/standings/selection";

const DOMAIN = "domain";
const SECTION = "section";
const BOARD = STANDINGS_PARAMS.board;
const FROM = "from";
const TO = "to";

export interface CatalogueListItem {
  slug: string;
  title: string;
  domain: string | null;
  flags?: { label: string; tone: BadgeTone }[];
  progress: { solved: number | null; total: number };
}

/**
 * Holds the catalogue chrome still during navigation. Without it the
 * site-wide page fade cross-fades the sidebar and tabs along with the panel.
 */
export function CatalogueFrame({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" update="page-stable">
      <div className="space-y-5">{children}</div>
    </ViewTransition>
  );
}

/**
 * Catalogue list sidebar. Reads the path so a tab switch updates highlights
 * without remounting; kept outside the page slot so it does not suspend with it.
 */
export function CatalogueSidebar({ lists }: { lists: CatalogueListItem[] }) {
  const { onLeaderboard, scope, ranked, directions, kept, listOf } = useCatalogueLocation(lists);

  const within = (slugs: string[]) => slugs.flatMap((slug) => listOf.get(slug) ?? []);

  const entry = (
    key: string,
    title: string,
    next: CatalogueScope,
    items: CatalogueListItem[],
    current: boolean,
    flags?: CatalogueListItem["flags"],
  ): ListNavEntry => {
    const href = onLeaderboard
      ? leaderboardHref() + queryString({ ...kept, ...boardScopeQuery(boardScopeOf(next, directions)) })
      : scopeHref(next, kept);
    const progress = items.length === 1
      ? items[0]!.progress
      : {
          total: items.reduce((n, item) => n + item.progress.total, 0),
          solved: items.every((item) => item.progress.solved !== null)
            ? items.reduce((n, item) => n + (item.progress.solved ?? 0), 0)
            : null,
        };
    return { key, title, href, current, progress, flags };
  };

  const groups: ListNavGroup[] = directions.map((group) => ({
    heading: group.heading,
    all: gathers(group)
      ? entry(
          group.heading,
          group.heading,
          { domain: group.heading },
          within(group.contests.map(({ slug }) => slug)),
          onLeaderboard
            ? sameBoardScope(boardScopeOf({ domain: group.heading }, directions), ranked)
            : scope !== null && "domain" in scope && scope.domain === group.heading,
        )
      : undefined,
    lists: group.contests.map((contest) => {
      const item = listOf.get(contest.slug)!;
      return entry(
        contest.slug,
        item.title,
        { section: contest.slug },
        [item],
        onLeaderboard
          ? sameBoardScope(boardScopeOf({ section: contest.slug }, directions), ranked)
          : scope !== null && "section" in scope && scope.section === contest.slug,
        item.flags,
      );
    }),
  }));

  return (
    <ListNav
      label="题单"
      all={entry(
        "all",
        "全部题目",
        null,
        lists,
        onLeaderboard
          ? sameBoardScope(boardScopeOf(null, directions), ranked)
          : scope === null,
      )}
      groups={groups}
    />
  );
}

/**
 * Title and view tabs for the current sidebar selection. Stay mounted across
 * tab switches so only the page body below them replaces.
 */
export function CataloguePanelHeader({
  lists,
  canRank,
}: {
  lists: CatalogueListItem[];
  canRank: boolean;
}) {
  const { onLeaderboard, scope, ranked, directions, listOf, kept } = useCatalogueLocation(lists);
  const listed = catalogueScopeOf(ranked, directions) ?? scope;

  const title = !listed ? "全部题目"
    : "section" in listed ? (listOf.get(listed.section)?.title ?? listed.section)
    : listed.domain;
  const flags = listed && "section" in listed ? listOf.get(listed.section)?.flags : undefined;

  const problems = scopeHref(listed, {});
  const leaderboard = canRank && (catalogueBoardSections(ranked.board) ?? []).length > 0
    ? leaderboardHref() + queryString({
        ...boardScopeQuery(ranked),
        ...(onLeaderboard ? kept : {}),
      })
    : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-fg text-xl font-semibold tracking-tight">{title}</h2>
        {flags?.map((flag) => (
          <Badge key={flag.label} tone={flag.tone}>{flag.label}</Badge>
        ))}
      </div>
      <CatalogueTabs
        current={onLeaderboard ? "leaderboard" : "problems"}
        problems={problems}
        leaderboard={leaderboard}
      />
    </>
  );
}

function useCatalogueLocation(lists: CatalogueListItem[]) {
  const pathname = usePathname();
  const raw = useSearchParams();
  const query = record(raw);
  const onLeaderboard = pathname === "/leaderboard" || pathname.startsWith("/leaderboard/");
  const sectionMatch = /^\/problems\/([^/]+)$/.exec(pathname);
  const section = sectionMatch?.[1];

  const directions = directionsOf(lists);
  const listOf = new Map(lists.map((list) => [list.slug, list]));

  const selected = section ? listOf.get(section) : undefined;
  const domain = !onLeaderboard && !selected ? raw.get(DOMAIN) : null;
  const direction = directions.filter(gathers).find(({ heading }) => heading === domain);
  const scope: CatalogueScope = selected ? { section: selected.slug }
    : direction ? { domain: direction.heading }
    : null;

  const ranked = onLeaderboard
    ? {
        board: typeof query[BOARD] === "string" ? query[BOARD] : undefined,
        sections: values(query[SECTION]),
      }
    : boardScopeOf(scope, directions);

  const from = readDay(raw.get(FROM) ?? undefined);
  const to = readDay(raw.get(TO) ?? undefined);
  const kept = onLeaderboard
    ? {
        ...without(query, BOARD, SECTION, PAGE_PARAM, FROM, TO),
        ...(from ? { [FROM]: from } : {}),
        ...(to ? { [TO]: to } : {}),
      }
    : without(query, PAGE_PARAM, DOMAIN);

  return { onLeaderboard, scope, ranked, directions, kept, listOf, query };
}

function scopeHref(scope: CatalogueScope, kept: SearchParams): string {
  if (scope === null) return catalogueHref() + queryString(kept);
  if ("section" in scope) return contestHref(scope.section) + queryString(kept);
  return catalogueHref() + queryString({ ...kept, [DOMAIN]: scope.domain });
}

function values(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function record(params: URLSearchParams): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length <= 1 ? all[0] : all;
  }
  return out;
}

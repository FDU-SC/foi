import { site } from "@/lib/site";

/**
 * Build all contest, problem and standings links. `site.catalogue` moves named
 * contests under `/problems/<contest>`; all others use `/contests`. Each pair
 * retains one URL.
 *
 * Read only site config so the proxy can import this without bundling the
 * contest registry.
 */

const CATALOGUE = "/problems";
const CONTESTS = "/contests";

/**
 * The standings path segment. Under a catalogued section it redirects to the
 * leaderboard, so `/problems/[section]/[slug]` cannot hold a problem by that name.
 */
export const STANDINGS_SEGMENT = "standings";

const named = site.catalogue ?? [];

/** The catalogued contests, in the order they are presented. */
export function catalogueSlugs(): string[] {
  return named;
}

export function isCatalogue(contestSlug: string): boolean {
  return named.includes(contestSlug);
}

/** The index every catalogued contest is reachable from. */
export function catalogueHref(): string {
  return CATALOGUE;
}

/** The one URL a `(contest, problem)` pair is reachable at. */
export function problemHref(contestSlug: string, problemSlug: string): string {
  return isCatalogue(contestSlug)
    ? `${CATALOGUE}/${contestSlug}/${problemSlug}`
    : `${CONTESTS}/${contestSlug}/problems/${problemSlug}`;
}

export function contestHref(contestSlug: string): string {
  return isCatalogue(contestSlug)
    ? `${CATALOGUE}/${contestSlug}`
    : `${CONTESTS}/${contestSlug}`;
}

export function catalogueLeaderboards() {
  return site.catalogueLeaderboards ?? [];
}

export function catalogueBoardFor(contestSlug: string) {
  return isCatalogue(contestSlug)
    ? catalogueLeaderboards().find((board) => board.sections.includes(contestSlug))
    : undefined;
}

/**
 * The catalogued sections a board spans, in catalogue order. Without an id it
 * is the total: every section except those only boards kept out of it name.
 * An unknown id spans nothing.
 */
export function catalogueBoardSections(board?: string): string[] | undefined {
  const boards = catalogueLeaderboards();
  if (board !== undefined) {
    const named = boards.find((one) => one.id === board);
    return named ? catalogueSlugs().filter((slug) => named.sections.includes(slug)) : undefined;
  }

  return catalogueSlugs().filter((slug) => {
    const holders = boards.filter((one) => one.sections.includes(slug));
    return holders.length === 0 || holders.some((one) => one.includeInTotal);
  });
}

export function leaderboardHref(board?: string, section?: string): string {
  const query = new URLSearchParams();
  if (board !== undefined) query.set("board", board);
  if (section !== undefined) query.set("section", section);
  return query.size > 0 ? `/leaderboard?${query}` : "/leaderboard";
}

/** A catalogued section's standings are the leaderboard narrowed to it. */
export function standingsHref(contestSlug: string): string {
  return isCatalogue(contestSlug)
    ? leaderboardHref(catalogueBoardFor(contestSlug)?.id, contestSlug)
    : `${CONTESTS}/${contestSlug}/${STANDINGS_SEGMENT}`;
}

/**
 * Map old catalogue URLs, including section standings, to their current URLs.
 * Run in the proxy before layouts stream, since page-level redirects can return
 * 200 with a meta refresh. Preserve the contest slug; unrecognised suffixes
 * redirect to the contest page.
 */
export function catalogueRedirect(pathname: string): string | null {
  for (const slug of named) {
    if (pathname.replace(/\/$/, "") === `${CATALOGUE}/${slug}/${STANDINGS_SEGMENT}`) {
      return standingsHref(slug);
    }
    const prefix = `${CONTESTS}/${slug}`;
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;

    const rest = pathname.slice(prefix.length);
    if (rest === "") return contestHref(slug);
    if (rest.replace(/\/$/, "") === `/${STANDINGS_SEGMENT}`) return standingsHref(slug);

    const problem = /^\/problems\/([^/]+)\/?$/.exec(rest);
    return problem ? problemHref(slug, problem[1]) : contestHref(slug);
  }

  return null;
}

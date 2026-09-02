import { site } from "@/lib/site";

/**
 * Where each contest's pages live.
 *
 * `site.catalogue` names the contests this deployment presents as a catalogue,
 * and those names decide everything here: the pairs they carry answer under
 * `/problems/<contest>`, the pairs every other contest carries answer under
 * `/contests`. A pair still has exactly one URL — naming a catalogue moves
 * where that URL starts, it does not add a second one.
 *
 * Every link to a contest, a problem or a leaderboard is built here, so the two
 * namespaces cannot drift apart. Path decisions only: this reads one list out
 * of the site config and answers in strings, which is what lets the proxy
 * consult it without pulling the contest registry into the edge bundle.
 */

const CATALOGUE = "/problems";
const CONTESTS = "/contests";

/** The static segment `/problems/[section]/[slug]` sits beside, and cannot hold. */
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

export function standingsHref(contestSlug: string): string {
  return isCatalogue(contestSlug)
    ? `${CATALOGUE}/${contestSlug}/${STANDINGS_SEGMENT}`
    : `${CONTESTS}/${contestSlug}/${STANDINGS_SEGMENT}`;
}

/**
 * Where a `/contests/...` path went, or null if it stayed.
 *
 * A catalogued contest keeps no address under `/contests`, and the proxy is the
 * only place that can say so before a layout starts streaming — refusing in a
 * page body would answer 200 with a meta refresh, which is not what "this
 * moved" means. The contest slug survives into the new path, so every old
 * address has a counterpart; anything unrecognised under the prefix lands on
 * that contest's own page.
 */
export function catalogueRedirect(pathname: string): string | null {
  for (const slug of named) {
    const prefix = `${CONTESTS}/${slug}`;
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;

    const rest = pathname.slice(prefix.length);
    if (rest === "") return contestHref(slug);
    if (rest === `/${STANDINGS_SEGMENT}`) return standingsHref(slug);

    const problem = /^\/problems\/([^/]+)\/?$/.exec(rest);
    return problem ? problemHref(slug, problem[1]) : contestHref(slug);
  }

  return null;
}

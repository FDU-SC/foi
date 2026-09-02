import { site } from "@/lib/site";

/**
 * Where each contest's pages live.
 *
 * `site.catalogue` names one contest, and that name decides everything here:
 * the pairs it carries answer under `/problems`, the pairs every other contest
 * carries answer under `/contests`. A pair still has exactly one URL — naming a
 * catalogue moves where that URL starts, it does not add a second one.
 *
 * Every link to a contest, a problem or a leaderboard is built here, so the two
 * namespaces cannot drift apart. Path decisions only: this reads one name out
 * of the site config and answers in strings, which is what lets the proxy
 * consult it without pulling the contest registry into the edge bundle.
 */

const CATALOGUE = "/problems";
const CONTESTS = "/contests";

/** The static segment `/problems/[slug]` sits beside, and therefore cannot hold. */
export const STANDINGS_SEGMENT = "standings";

const named = site.catalogue;

export function catalogueSlug(): string | undefined {
  return named;
}

export function isCatalogue(contestSlug: string): boolean {
  return named !== undefined && contestSlug === named;
}

/** The one URL a `(contest, problem)` pair is reachable at. */
export function problemHref(contestSlug: string, problemSlug: string): string {
  return isCatalogue(contestSlug)
    ? `${CATALOGUE}/${problemSlug}`
    : `${CONTESTS}/${contestSlug}/problems/${problemSlug}`;
}

export function contestHref(contestSlug: string): string {
  return isCatalogue(contestSlug) ? CATALOGUE : `${CONTESTS}/${contestSlug}`;
}

export function standingsHref(contestSlug: string): string {
  return isCatalogue(contestSlug)
    ? `${CATALOGUE}/${STANDINGS_SEGMENT}`
    : `${CONTESTS}/${contestSlug}/${STANDINGS_SEGMENT}`;
}

/**
 * Where a `/contests/...` path went, or null if it stayed.
 *
 * The catalogue keeps no address under `/contests`, and the proxy is the only
 * place that can say so before a layout starts streaming — refusing in a page
 * body would answer 200 with a meta refresh, which is not what "this moved"
 * means. Anything under the catalogue's old prefix that has no counterpart
 * lands on the catalogue itself.
 */
export function catalogueRedirect(pathname: string): string | null {
  if (named === undefined) return null;

  const prefix = `${CONTESTS}/${named}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;

  const rest = pathname.slice(prefix.length);
  if (rest === "") return CATALOGUE;
  if (rest === `/${STANDINGS_SEGMENT}`) {
    return `${CATALOGUE}/${STANDINGS_SEGMENT}`;
  }

  const problem = /^\/problems\/([^/]+)\/?$/.exec(rest);
  return problem ? `${CATALOGUE}/${problem[1]}` : CATALOGUE;
}

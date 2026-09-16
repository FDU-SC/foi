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
 * Map catalogued `/contests/...` paths to their new URLs; return null otherwise.
 * Run in the proxy before layouts stream, since page-level redirects can return
 * 200 with a meta refresh. Preserve the contest slug; unrecognised suffixes
 * redirect to the contest page.
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

import { site } from "@/lib/site";
import { toPublicConfig, type ProblemConfig } from "./types";
import { viewsFor, type ProblemFacet } from "./views";

/** A dimension as the whole catalogue presents it, values already ordered. */
export interface FacetGroup {
  key: string;
  label: string;
  values: string[];
}

/** Chosen values per dimension. Within a key OR, across keys AND. */
export type FacetSelection = Record<string, string[]>;

interface Accumulator {
  label: string;
  /** How many problems carry each value. Insertion order is catalogue order. */
  counts: Map<string, number>;
  /** Declared orders merged in the order the catalogue offered them. */
  declared: string[];
}

/**
 * Both the registry and the view table are fixed at module load, so a problem's
 * facets never change and the content-side parse runs once per slug.
 */
const cache = new Map<string, ProblemFacet[]>();

export function facetsOf(config: ProblemConfig): ProblemFacet[] {
  const hit = cache.get(config.slug);
  if (hit) return hit;

  const facets = viewsFor(config.slug).facets?.(toPublicConfig(config)) ?? [];
  cache.set(config.slug, facets);
  return facets;
}

/**
 * A value nothing carries is a dead filter, so declared order is intersected
 * with what the catalogue actually holds rather than offered whole.
 */
function orderValues({ counts, declared }: Accumulator): string[] {
  const known = declared.filter((value) => counts.has(value));
  const rest = [...counts.keys()].filter((value) => !declared.includes(value));

  rest.sort(
    (a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b, site.lang),
  );

  return [...known, ...rest];
}

/** Every dimension the given problems offer, in the order they first appear. */
export function collectFacets(configs: ProblemConfig[]): FacetGroup[] {
  const groups = new Map<string, Accumulator>();

  for (const config of configs) {
    for (const facet of facetsOf(config)) {
      let group = groups.get(facet.key);
      if (!group) {
        group = { label: facet.label, counts: new Map(), declared: [] };
        groups.set(facet.key, group);
      }

      for (const value of facet.order ?? []) {
        if (!group.declared.includes(value)) group.declared.push(value);
      }
      for (const value of facet.values) {
        group.counts.set(value, (group.counts.get(value) ?? 0) + 1);
      }
    }
  }

  return [...groups]
    .filter(([, group]) => group.counts.size > 0)
    .map(([key, group]) => ({
      key,
      label: group.label,
      values: orderValues(group),
    }));
}

export function matchesFacets(
  config: ProblemConfig,
  selection: FacetSelection,
): boolean {
  const asked = Object.entries(selection).filter(
    ([, values]) => values.length > 0,
  );
  if (asked.length === 0) return true;

  const held = new Map(
    facetsOf(config).map((facet) => [facet.key, facet.values]),
  );

  return asked.every(([key, values]) => {
    const mine = held.get(key);
    return mine !== undefined && values.some((value) => mine.includes(value));
  });
}

/**
 * How many problems each value would leave, judged against every dimension
 * except its own — so a value reads as a dead end only when it truly is one,
 * and adding a second value inside one dimension still widens the result.
 *
 * The caller filters by anything outside the facets first; this only accounts
 * for the facets themselves.
 */
export function facetCounts(
  configs: ProblemConfig[],
  groups: FacetGroup[],
  selection: FacetSelection,
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();

  for (const group of groups) {
    const elsewhere = { ...selection, [group.key]: [] };
    const perValue = new Map(group.values.map((value) => [value, 0]));

    for (const config of configs) {
      if (!matchesFacets(config, elsewhere)) continue;

      for (const facet of facetsOf(config)) {
        if (facet.key !== group.key) continue;
        for (const value of facet.values) {
          const seen = perValue.get(value);
          if (seen !== undefined) perValue.set(value, seen + 1);
        }
      }
    }

    counts.set(group.key, perValue);
  }

  return counts;
}

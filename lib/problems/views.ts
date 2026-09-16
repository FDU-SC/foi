import type { ComponentType } from "react";
import { problemViews } from "@/content/_modules/problem-views";
import type { VerdictPreset } from "@/lib/presentation";
import type { PublicProblemConfig } from "@/lib/problems/types";

/**
 * One problem's position along one dimension a contest may offer.
 *
 * The platform never learns what a key means. It collects the values, offers
 * them, and matches strings — which is what keeps difficulty and tags inside
 * `ui`, where a deployment owns them.
 */
export interface ProblemFacet {
  /** Identifier in the URL. Lowercase letters, digits and hyphens. */
  key: string;

  label: string;

  /** Empty means this problem sits nowhere along the dimension. */
  values: string[];

  /**
   * The dimension's value order, merged across problems that declare it.
   * Without one, values are ordered by how many problems carry them.
   */
  order?: string[];
}

export interface ProblemViews {

  PayloadView?: ComponentType<{ payload: unknown }>;

  VerdictDetail?: ComponentType<{ detail: unknown }>;

  verdicts?: Record<string, VerdictPreset>;

  /**
   * The badges beside a problem's title.
   *
   * `facets` arrives already narrowed to what the contest carrying this problem
   * offers, so a round that gives away nothing hands over an empty list. Render
   * what is passed rather than reaching back into `config.ui`, or hiding a
   * dimension from the filter bar would leave it showing here.
   */
  Badges?: ComponentType<{
    config: PublicProblemConfig;
    facets: ProblemFacet[];
  }>;

  /** Which dimensions this problem sits on. Absent means none of them. */
  facets?: (config: PublicProblemConfig) => ProblemFacet[];
}

const registry = new Map<string, ProblemViews>(
  Object.entries(problemViews),
);

export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}

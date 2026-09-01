import type { ComponentType } from "react";
import { problemViews } from "@/content/_modules/problem-views";
import type { VerdictPreset } from "@/lib/presentation";
import type { PublicProblemConfig } from "@/lib/problems/types";

/**
 * One problem's position along one dimension the catalogue may filter by.
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

  Badges?: ComponentType<{ config: PublicProblemConfig }>;

  facets?: (config: PublicProblemConfig) => ProblemFacet[];
}

const registry = new Map<string, ProblemViews>(
  Object.entries(problemViews),
);

export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}

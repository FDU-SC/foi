import type { SubmissionRecordState } from "@/lib/backend/types";
import type { ComponentType } from "react";
import { presetViews } from "@/lib/authoring/registry";
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

export interface ProgressSubmission {
  id: string;
  state: SubmissionRecordState;
  result: unknown;
  createdAt: Date;
  judgedAt: Date | null;
}

export interface ProblemProgress {
  state: "untouched" | "attempted" | "solved";
  verdict: VerdictPreset | null;
}

export interface ProblemViews {

  PayloadView?: ComponentType<{ payload: unknown }>;

  VerdictDetail?: ComponentType<{ detail: unknown }>;

  describeResult?: (result: unknown) => VerdictPreset;

  /** One person's complete history for one contest and problem, as the viewer may see it. */
  progress?: (history: readonly ProgressSubmission[]) => ProblemProgress;

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

/**
 * How one problem renders.
 *
 * A problem that ships a `views.tsx` is keyed by slug and needs nothing else.
 * An authored one has no module — it names a preset, and the deployment's
 * presets answer for it. The preset therefore has to arrive from the caller:
 * `PublicProblemConfig` carries it, because the same lookup happens in the
 * browser, where there is no snapshot of the database to consult.
 *
 * An unknown slug with no preset renders nothing, which is what an unrecognised
 * problem looks like everywhere else rather than a guess at a shape.
 */
export function viewsFor(slug: string, preset?: string): ProblemViews {
  const own = registry.get(slug);
  if (own) return own;
  return preset ? presetViews(preset).views : {};
}

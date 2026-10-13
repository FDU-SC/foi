import type { ProblemViews } from "@/lib/problems/views";

/**
 * What the deployment tells the platform about authoring problems.
 *
 * Everything an authored problem carries beyond its judge configuration is
 * deployment vocabulary: which presentation fields exist, what they mean, and
 * which display preset renders a statement. The platform collects and stores
 * that vocabulary without learning it — the same rule that keeps `problem.ui`
 * opaque — so a deployment renames a field by editing one file.
 */

/** One value a choice field offers. */
export interface UiFieldChoice {
  value: string;
  label: string;
}

/**
 * One presentation field of `problem.ui`.
 *
 * `key` is written verbatim into the stored JSON, so it must be the key the
 * deployment's `ProblemViews.facets` reads.
 */
export type UiField =
  | { key: string; label: string; kind: "text"; hint?: string; placeholder?: string }
  | { key: string; label: string; kind: "tags"; hint?: string }
  | { key: string; label: string; kind: "choice"; options: UiFieldChoice[]; hint?: string }
  | { key: string; label: string; kind: "multi"; options: UiFieldChoice[]; hint?: string };

/** How a choice field's value is shaped once stored. */
export const FIELD_KINDS = ["text", "tags", "choice", "multi"] as const;

/**
 * One display shape an author may pick, as a whole `ProblemViews`.
 *
 * An author never writes a view: the set of shapes is the deployment's, and
 * `id` is what `problems.views_preset` stores.
 */
export interface ViewsPreset {
  id: string;
  label: string;
  description: string;
  views: ProblemViews;
}

export interface AuthoringConfig {
  /** Used when a problem names a preset the deployment no longer offers. */
  defaultPreset: string;

  /**
   * The backend an authored problem is judged by.
   *
   * A problem that ships in the repository names its own backend in its
   * `problem.ts`; one authored here is judged by whichever backend this
   * deployment offers for authoring. It is a deployment's name, so it is
   * declared here rather than spelled out in platform code — a deployment that
   * routes authored problems to a different machine edits this line.
   */
  authoredBackend: string;

  uiFields: readonly UiField[];

  presets: readonly ViewsPreset[];
}

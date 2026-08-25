import type { MDXComponents } from "mdx/types";
import type { BadgeTone } from "@/components/ui/badge";

/** How one verdict status is drawn: a full name, a short badge, a colour. */
export interface VerdictPreset {
  label: string;
  short: string;
  tone: BadgeTone;
}

/**
 * What a deployment supplies for the whole site, as opposed to for one problem.
 *
 * Two slots, and the boundary between them and `ProblemViews` is who the thing
 * belongs to. A statement's vocabulary and the name of a verdict status are
 * facts about this competition: every problem writes `<Callout>` and every
 * board says `AC`, so registering them once is right. A submission's payload
 * and a verdict's `detail` are not — each was produced by one problem's
 * submitter and one problem's backend — so those live in
 * `content/problems/<slug>/views.tsx` and are looked up by slug.
 *
 * Both are optional. There is no fallback object to keep in step: an absent
 * `mdxComponents` means a statement may write only the elements the kernel
 * styles, and an absent `verdicts` means every status renders as itself.
 */
export interface Presentation {
  /**
   * Extra components every statement may use without importing them.
   *
   * Merged over the kernel's element mapping in `mdx-components.tsx`, which
   * keeps the styling of headings, tables and code consistent no matter what a
   * deployment adds. A key that collides with an element name wins, which is
   * the escape hatch for a deployment that wants its own `pre`.
   */
  mdxComponents?: MDXComponents;

  /**
   * Names and colours for the verdict statuses this deployment expects.
   *
   * `verdictSchema` accepts any status a backend cares to send, so this is a
   * lookup and never a whitelist: an unlisted status renders as itself, with a
   * colour `describeVerdict` derives from the score. Nine of these used to be
   * built in, spelling out one grading tradition's abbreviations — which was
   * fine right up against the observation that the protocol had gone out of
   * its way not to name any of them.
   */
  verdicts?: Record<string, VerdictPreset>;
}

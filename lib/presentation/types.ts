import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import type { BadgeTone } from "@/components/ui/badge";
import type { PublicProblemConfig } from "@/lib/problems/types";

/** How one verdict status is drawn: a full name, a short badge, a colour. */
export interface VerdictPreset {
  label: string;
  short: string;
  tone: BadgeTone;
}

/**
 * What a deployment supplies for the whole site, as opposed to for one problem.
 *
 * Three slots, and the boundary between them and `ProblemViews` is who the
 * thing belongs to. A statement's vocabulary, the name of a verdict status and
 * the way a problem is labelled in a list are facts about this competition:
 * every problem writes `<Callout>` and every board says `AC`, so registering
 * them once is right. A submission's payload and a verdict's `detail` are not
 * — each was produced by one problem's submitter and one problem's backend —
 * so those live in `content/problems/<slug>/views.tsx` and are looked up by
 * slug.
 *
 * All three are optional. There is no fallback object to keep in step: an
 * absent `mdxComponents` means a statement may write only the elements the
 * kernel styles, an absent `verdicts` means every status renders as itself,
 * and an absent `ProblemBadges` means a problem is listed by its slug and
 * title alone.
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

  /**
   * How a problem is labelled wherever the kernel lists or heads one.
   *
   * Rendered in the problem table, on the front page's recent list and under a
   * statement's title, always with the same props, so a deployment writes the
   * labelling once and gets it in all three places.
   *
   * Here because the kernel has no opinion about what a problem is worth
   * saying about. It used to: `tags` and `difficulty` were fields on
   * `problemConfigSchema` that nothing but these three pages ever read, which
   * made the platform's problem schema the place a competition declared it
   * sorts by tag and grades on a single difficulty scale. Both now live in the
   * opaque `ui`, and what to draw from them is this component's decision —
   * along with `maxScore`, which stays in the schema because scoring reads it
   * but which no longer has to be shown as「满分」on a board that does not
   * score out of one.
   *
   * Given the public projection, so it is safe to render in a browser chunk:
   * `backend.config` is not on it.
   */
  ProblemBadges?: ComponentType<{ config: PublicProblemConfig }>;
}

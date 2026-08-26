import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import { presentationModules } from "@/content-presentation-modules";
import type { PublicProblemConfig } from "@/lib/problems/types";
import { loadSingletonModule, requiredExport } from "@/lib/singleton-module";

/**
 * What a deployment says about how this site looks, and the one derivation the
 * kernel makes from it.
 *
 * Three slots, the registry that finds them and `describeVerdict`, which is
 * the only reader that has to work when a slot is empty. One file rather than
 * three, because reading the shape, the discovery and the fallback together is
 * what makes the split between "the deployment's vocabulary" and "what the
 * protocol already fixed" visible.
 */

/**
 * The colours anything on this site may be drawn in.
 *
 * Declared here rather than derived from the class map in
 * `components/ui/badge.tsx`. Running it the other way makes the protocol layer
 * — `lib/backend/types.ts` imports this — depend on a React component for a
 * string union.
 *
 * Naming the members rather than reading them off the map loses no
 * exhaustiveness: `TONES` is annotated with this, so a tone added here and not
 * styled is a compile error at the component.
 */
export type BadgeTone =
  | "neutral"
  | "ok"
  | "err"
  | "warn"
  | "partial"
  | "info"
  | "primary";

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
 * so those are registered per slug in `lib/problems/views.ts`.
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
   * colour `describeVerdict` derives from the score. The kernel ships none of
   * them, because the protocol goes out of its way not to name any.
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
   * saying about. Tags and difficulty live in the opaque `ui`, and what to draw
   * from them is this component's decision — along with `maxScore`, which stays
   * in the schema because scoring reads it but which need not be shown as
   *「满分」on a board that does not score out of one.
   *
   * Given the public projection, so it is safe to render in a browser chunk:
   * `backend.config` is not on it.
   */
  ProblemBadges?: ComponentType<{ config: PublicProblemConfig }>;
}

/**
 * What this deployment renders site-wide, or nothing.
 *
 * Both slots are optional, so an empty registry is a legal deployment: every
 * statement falls back to the elements `mdx-components.tsx` styles, and every
 * verdict status renders as its own string. Per-problem rendering is not here
 * — see `lib/problems/views.ts`.
 */
function buildRegistry(): Presentation {
  const found = loadSingletonModule(presentationModules, "题面组件");
  if (!found) return {};

  const exported = requiredExport(
    found,
    "presentation",
    "见 lib/presentation.ts",
  );

  if (typeof exported !== "object" || exported === null) {
    throw new Error(`${found.path} 导出的 presentation 必须是一个对象`);
  }

  return exported as Presentation;
}

export const presentation: Presentation = buildRegistry();

/**
 * How to render a finished submission's badge.
 *
 * Takes the resolved columns rather than the verdict, because that is where
 * the kernel's copy of these lives and because a backend may have declared a
 * pass without reporting any score at all.
 *
 * The lookup comes from `content/`; the fallback below does not, and the split
 * is the whole design. What an `accepted` status should be called in this
 * competition's language is a deployment's business. What a *number* means is
 * not: full marks is a pass, some marks is partial, no marks is a failure, and
 * a declared `accepted` outranks all three. That much the protocol already
 * fixed, so the kernel can colour any status it has never seen.
 */
export function describeVerdict(result: {
  outcome: string | null;
  score: number | null;
  maxScore: number | null;
  accepted: boolean | null;
}): VerdictPreset {
  const label = result.outcome ?? "已评测";
  const preset = result.outcome
    ? presentation.verdicts?.[result.outcome]
    : undefined;
  if (preset) return preset;

  // An unrecognised status, so the tone has to come from the numbers. A
  // declared pass settles it; otherwise full marks reads as a pass, anything
  // above zero as partial. With no score reported there is nothing to grade
  // the colour on, which is what neutral is for.
  const tone: BadgeTone =
    result.accepted !== null
      ? result.accepted
        ? "ok"
        : "err"
      : result.score === null
        ? "neutral"
        : result.maxScore !== null && result.score >= result.maxScore
          ? "ok"
          : result.score > 0
            ? "partial"
            : "err";

  return { label, short: label, tone };
}

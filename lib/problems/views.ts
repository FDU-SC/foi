import type { ComponentType } from "react";
import { problemViewModules } from "@/content/problem-view-modules";
import type { Verdict } from "@/lib/backend/types";

/**
 * How one problem draws its own results.
 *
 * Three of the kernel's data contracts are deliberately opaque: a submission's
 * `payload`, a verdict's `detail`, and a problem's `ui`. Opaque means the
 * kernel stores and forwards them without looking inside, and it held
 * everywhere except on screen — the submission pages quietly knew that a
 * payload has a `source` or a `flag` in it and that a detail has a `tests`
 * array. Those were true of a particular set of problems and of nothing else.
 *
 * So the interpretation moves to the problem, which is where it belongs:
 * `payload` was shaped by that problem's submitter and `detail` was written by
 * that problem's backend, so nothing else is in a position to read either.
 * This is the same arrangement `Ruleset.render` already has — a format draws
 * the cells it computed — and it is per problem rather than per contest
 * because a submission need not belong to a round at all.
 *
 * Both slots are optional and both have a kernel fallback that shows the value
 * as what it is: a pretty-printed object. That fallback is not a placeholder
 * waiting for a nicer default; it is the honest rendering of a field nobody
 * has claimed, and it is what a submission to a since-deleted problem falls
 * back to for good.
 */
export interface ProblemViews {
  /** How a submission is shown back to the person who made it. */
  PayloadView?: ComponentType<{ payload: unknown }>;
  /** How this problem's `verdict.detail` is drawn. */
  VerdictDetail?: ComponentType<{ verdict: Verdict }>;
}

const SLUG = /\/problems\/([^/]+)\/views\.tsx$/;

function buildRegistry(): Map<string, ProblemViews> {
  const registry = new Map<string, ProblemViews>();

  for (const [path, mod] of Object.entries(problemViewModules)) {
    const slug = path.match(SLUG)?.[1];
    // The glob cannot match anything else, so a miss means the pattern above
    // and the one in `content/problem-view-modules.ts` have drifted apart.
    if (!slug) throw new Error(`无法从 ${path} 解析出题目 slug`);

    const exported = mod as ProblemViews;
    for (const key of ["PayloadView", "VerdictDetail"] as const) {
      const value = exported[key];
      if (value !== undefined && typeof value !== "function") {
        throw new Error(`${path} 导出的 ${key} 必须是一个组件`);
      }
    }

    registry.set(slug, {
      PayloadView: exported.PayloadView,
      VerdictDetail: exported.VerdictDetail,
    });
  }

  return registry;
}

const registry = buildRegistry();

/**
 * Empty for a problem that ships no `views.tsx`, and for one that has been
 * deleted from the repository since somebody submitted to it. Both render as
 * the JSON they are.
 */
export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}

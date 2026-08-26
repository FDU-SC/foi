import type { ComponentType } from "react";
import {
  problemViewDefaultModules,
  problemViewModules,
} from "@/content-problem-view-modules";
import type { Verdict } from "@/lib/backend/types";
import { loadSingletonModule, requiredExport } from "@/lib/singleton-module";

/**
 * How one problem draws its own results.
 *
 * Three of the kernel's data contracts are deliberately opaque: a submission's
 * `payload`, a verdict's `detail`, and a problem's `ui`. Opaque means the
 * kernel stores and forwards them without looking inside, and drawing them is
 * where that is easiest to break — a submission page that knows a payload has
 * a `source` or a `flag` in it, or a detail a `tests` array, knows something
 * true of one set of problems and of nothing else.
 *
 * So the interpretation belongs to the problem:
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

/** A slot may be empty, but a filled one has to hold a component. */
function checked(source: string, exported: ProblemViews): ProblemViews {
  for (const key of ["PayloadView", "VerdictDetail"] as const) {
    const value = exported[key];
    if (value !== undefined && typeof value !== "function") {
      throw new Error(`${source} 的 ${key} 必须是一个组件`);
    }
  }

  return {
    PayloadView: exported.PayloadView,
    VerdictDetail: exported.VerdictDetail,
  };
}

/**
 * Two sources, in precedence order.
 *
 * A deployment states once which problems take its shared renderings, because
 * for most of them that is the entire answer and a file per problem saying so
 * is a file per problem that can fall out of step. A problem that wants
 * something else writes `content/problems/<slug>/views.tsx`, and that file
 * replaces its table entry rather than merging with it — the problem's own
 * file is that problem's whole statement about its rendering, including which
 * slots it leaves empty.
 *
 * Neither source is required. What is left out of both is left out, and
 * `viewsFor` answers for that case.
 */
function buildRegistry(): Map<string, ProblemViews> {
  const registry = new Map<string, ProblemViews>();

  const defaults = loadSingletonModule(
    problemViewDefaultModules,
    "题目渲染的默认表",
  );
  if (defaults) {
    const declared = requiredExport(
      defaults,
      "problemViews",
      "见 lib/problems/views.ts 的 ProblemViews",
    );
    if (typeof declared !== "object" || declared === null) {
      throw new Error(
        `${defaults.path} 导出的 problemViews 必须是一个以 slug 为键的对象`,
      );
    }

    for (const [slug, views] of Object.entries(
      declared as Record<string, ProblemViews>,
    )) {
      registry.set(slug, checked(`${defaults.path} 里的 ${slug}`, views));
    }
  }

  for (const [path, mod] of Object.entries(problemViewModules)) {
    const slug = path.match(SLUG)?.[1];
    // The glob cannot match anything else, so a miss means the pattern above
    // and the one in `content-problem-view-modules.ts` have drifted apart.
    if (!slug) throw new Error(`无法从 ${path} 解析出题目 slug`);

    registry.set(slug, checked(path, mod as ProblemViews));
  }

  return registry;
}

const registry = buildRegistry();

/**
 * Empty for a problem that claims no rendering, and for one that has been
 * deleted from the repository since somebody submitted to it. Both render as
 * the JSON they are.
 */
export function viewsFor(slug: string): ProblemViews {
  return registry.get(slug) ?? {};
}

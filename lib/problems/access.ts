import { authorize } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { embargoOf, type Embargo } from "@/lib/contests/by-problem";
import { allProblems, problemBySlug } from "./registry";
import type { ProblemConfig } from "./types";

/** The policy that reads `visibleTo`. Reaching a problem any other way is a
 * preview of something not yet public. */
const AUDIENCE = "builtin:problem-audience";

export interface ProblemView {
  config: ProblemConfig;

  /** The contest holding this problem back, if it has not opened yet. */
  embargo: Embargo | null;

  /** Reached through some policy other than the audience one. */
  preview: boolean;
}

function viewOf(
  config: ProblemConfig,
  viewer: Viewer,
  now: Date,
): ProblemView | undefined {
  const decision = authorize("problem.read", config, viewer, { now });
  if (!decision.allow) return undefined;

  return {
    config,
    embargo: embargoOf(config.slug, now),
    preview: decision.via !== AUDIENCE,
  };
}

/**
 * The problem catalogue.
 *
 * Retired problems keep their permalink but drop out of the listing: appearing
 * in the catalogue is an invitation to work on a problem, and a retired one no
 * longer accepts work.
 */
export function problemsFor(viewer: Viewer, now = new Date()): ProblemView[] {
  return allProblems().flatMap((config) => {
    if (config.retired) return [];
    return viewOf(config, viewer, now) ?? [];
  });
}

/**
 * Newest first.
 *
 * `addedAt` is optional, so this is a refinement of the catalogue rather than a
 * replacement for it: dated problems lead in reverse chronology, and the rest
 * follow in `order`. A catalogue that dates nothing therefore reads exactly as
 * `problemsFor` does.
 */
export function recentProblemsFor(
  viewer: Viewer,
  limit: number,
  now = new Date(),
): ProblemView[] {
  return [...problemsFor(viewer, now)]
    .sort((a, b) => byRecency(a.config, b.config))
    .slice(0, limit);
}

/** Undated last. Ties hold their catalogue order, since sort is stable. */
function byRecency(a: ProblemConfig, b: ProblemConfig): number {
  const left = a.addedAt?.getTime();
  const right = b.addedAt?.getTime();

  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

export function problemFor(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): ProblemView | undefined {
  const config = problemBySlug(slug);
  return config ? viewOf(config, viewer, now) : undefined;
}

export type ProblemStatus =
  | { kind: "live"; title: string }
  | { kind: "retired"; title: string }
  | { kind: "gone"; title: string };

export function problemStatus(
  slug: string,
  fallbackTitle: string,
): ProblemStatus {
  const config = problemBySlug(slug);
  if (!config) return { kind: "gone", title: fallbackTitle };
  return {
    kind: config.retired ? "retired" : "live",
    title: config.title,
  };
}

export { loadStatement } from "./registry";

import { inAudience, type Audience } from "@/lib/permissions/audience";
import type { Viewer } from "@/lib/permissions/viewer";
import { contestFor } from "@/lib/contests/access";
import { allContests } from "@/lib/contests/registry";
import {
  hasContestEnded,
  hasContestStarted,
  type ContestConfig,
} from "@/lib/contests/types";
import { allProblems, problemBySlug } from "./registry";
import type { ProblemConfig } from "./types";

export type Visibility =
  | { visible: true }
  | { visible: false; reason: "audience"; audience: Audience }
  | {
      visible: false;
      reason: "embargo";
      contestSlug: string;
      opensAt: Date;
    };

export type ProblemOverride = "problem.viewAll" | "contest";

export interface ProblemView {
  config: ProblemConfig;

  gate: Visibility;

  reachedVia: ProblemOverride | null;

  open: boolean;
}

function buildIndex(): Map<string, ContestConfig[]> {
  const index = new Map<string, ContestConfig[]>();

  for (const contest of allContests()) {
    for (const entry of contest.problems) {
      const contests = index.get(entry.slug);
      if (contests) contests.push(contest);
      else index.set(entry.slug, [contest]);
    }
  }

  return index;
}

const contestsByProblem = buildIndex();

export function contestsUsing(slug: string): ContestConfig[] {
  return contestsByProblem.get(slug) ?? [];
}

export function problemVisibility(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): Visibility {
  const config = problemBySlug(slug);

  if (!config) return { visible: false, reason: "audience", audience: [] };

  if (!inAudience(config.visibleTo, viewer)) {
    return { visible: false, reason: "audience", audience: config.visibleTo };
  }

  let embargo: { contestSlug: string; opensAt: Date } | null = null;

  for (const contest of contestsUsing(slug)) {
    if (hasContestStarted(contest, now)) {
      return { visible: true };
    }

    if (!embargo || contest.startsAt < embargo.opensAt) {
      embargo = { contestSlug: contest.slug, opensAt: contest.startsAt };
    }
  }

  return embargo
    ? { visible: false, reason: "embargo", ...embargo }
    : { visible: true };
}

function reachableViaContest(slug: string, viewer: Viewer, now: Date): boolean {
  return contestsUsing(slug).some(
    (contest) =>
      hasContestStarted(contest, now) &&
      contestFor(contest.slug, viewer) !== undefined,
  );
}

function overrideFor(
  slug: string,
  gate: Visibility,
  viewer: Viewer,
  now: Date,
): ProblemOverride | null {
  if (gate.visible) return null;
  if (viewer.can("problem.viewAll")) return "problem.viewAll";
  if (reachableViaContest(slug, viewer, now)) return "contest";
  return null;
}

function gatedView(
  config: ProblemConfig,
  viewer: Viewer,
  now: Date,
): Omit<ProblemView, "reachedVia"> {
  const gate = problemVisibility(config.slug, viewer, now);
  return { config, gate, open: gate.visible && !config.retired };
}

function viewOf(config: ProblemConfig, viewer: Viewer, now: Date): ProblemView {
  const entry = gatedView(config, viewer, now);
  return {
    ...entry,
    reachedVia: overrideFor(config.slug, entry.gate, viewer, now),
  };
}

export function problemsFor(viewer: Viewer, now = new Date()): ProblemView[] {
  const override = viewer.can("problem.viewAll");
  return allProblems()
    .map((config) => gatedView(config, viewer, now))
    .filter((entry) => override || entry.open)
    .map((entry) => ({
      ...entry,
      reachedVia: overrideFor(entry.config.slug, entry.gate, viewer, now),
    }));
}

export function problemFor(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): ProblemView | undefined {
  const config = problemBySlug(slug);
  if (!config) return undefined;

  const view = viewOf(config, viewer, now);
  if (!view.gate.visible && view.reachedVia === null) return undefined;

  return view;
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

export function problemGateWarnings(now = new Date()): string[] {
  const warnings = allProblems()
    .filter((problem) => problem.visibleTo?.length === 0)
    .filter((problem) => contestsUsing(problem.slug).length > 0)
    .map((problem) => {
      const slugs = contestsUsing(problem.slug).map((contest) => contest.slug);
      return `题目 "${problem.slug}" 的 visibleTo 是空数组（对任何人都不可见），却被比赛 ${slugs.join("、")} 引用；比赛开始后它仍然不会公开。`;
    });

  for (const problem of allProblems()) {
    if (!problem.retired) continue;

    const unfinished = contestsUsing(problem.slug).filter(
      (contest) => !hasContestEnded(contest, now),
    );
    if (unfinished.length === 0) continue;

    warnings.push(
      `题目 "${problem.slug}" 已下架，但比赛 ${unfinished.map((c) => c.slug).join("、")} 还没结束；` +
        `题面仍然可读，但这些比赛期间没有人能提交它。`,
    );
  }

  return warnings;
}

export { loadStatement } from "./registry";

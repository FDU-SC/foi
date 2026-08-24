import { inAudience, type Audience } from "@/lib/auth/audience";
import type { Viewer } from "@/lib/auth/viewer";
import { allContests } from "@/lib/contests/registry";
import { contestPhase, type ContestConfig } from "@/lib/contests/types";
import { allProblems, problemBySlug } from "./registry";
import type { ProblemConfig } from "./types";

/**
 * How anything that renders to a person obtains a problem.
 *
 * Everything in this repository ships on deploy, and a contest's problems have
 * to be in the repository before the contest starts. Without a gate, merging
 * next week's contest leaks next week's problems.
 *
 * The gate lives at the point of retrieval rather than at each call site, and
 * that placement is the whole design. It was tried the other way first: the
 * registry handed out problems and each page filtered afterwards. `/problems`
 * remembered and the home page did not, because nothing about asking the
 * registry for problems suggested a second step existed. A rule you have to
 * remember is a rule that gets missed on the seventh page.
 *
 * So there is no way to ask this module for a problem without saying who is
 * asking. The raw accessors still exist in `./registry` for the callers that
 * legitimately need every problem regardless of viewer — the mirror sync, the
 * drift report, load-time validation — and they are named to make reaching for
 * them a visible choice in a diff.
 *
 * This module may import both registries; neither may import it.
 * `lib/contests/registry.ts` already depends on `lib/problems/registry.ts` for
 * its load-time checks, and both build eagerly at module load, so a back edge
 * from either would be a cycle evaluated during startup.
 */

export type Visibility =
  | { visible: true }
  | { visible: false; reason: "audience"; audience: Audience }
  | {
      visible: false;
      reason: "embargo";
      contestSlug: string;
      opensAt: Date;
    };

/** A problem plus why it is, or is not, open to the viewer who asked. */
export interface ProblemView {
  config: ProblemConfig;

  /** Who may read it. `retired` deliberately does not participate. */
  gate: Visibility;

  /**
   * Whether anything new may be sent to it: visible to this viewer, and not
   * retired.
   *
   * One field rather than `gate.visible && !config.retired` at each call site.
   * Three places ask — the submission route, `actionFor`, and the statement
   * page's submit panel — and this module exists because the fourth place is
   * the one that forgets. Retiring a problem must not become a rule people
   * have to remember.
   */
  open: boolean;
}

/**
 * Problem slug to the contests that use it.
 *
 * Built once at module load: the registries are frozen after that, and only
 * the phase of each contest moves. So the index is a lookup, never a verdict —
 * the verdict is computed per request against the clock, which is what lets a
 * problem open at its start time with no deploy.
 */
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

/** Every contest this problem appears in, in registry order. */
export function contestsUsing(slug: string): ContestConfig[] {
  return contestsByProblem.get(slug) ?? [];
}

/**
 * Whether `slug` is open at `now`, and why not when it is not.
 *
 * Two axes, asked in this order. *Who* comes first and does not move with the
 * clock: a problem no group has been given stays dark whatever its contest is
 * doing. *When* comes second: a contest that has started releases its
 * problems, so a statement becomes readable the moment the round opens rather
 * than at the next deploy — scheduling a release without shipping one is the
 * entire point of gating on the phase.
 *
 * A problem given to nobody but placed in a contest therefore never opens,
 * which is almost never what the author meant; `problemGateWarnings()` says so
 * at startup rather than letting it be discovered mid-round.
 */
export function problemVisibility(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): Visibility {
  const config = problemBySlug(slug);

  // A slug nothing declares is withheld rather than allowed. `problemFor`
  // already answers `undefined` for one, so no caller sees a difference today
  // — but this is exported, and a gate whose default is "yes" is the wrong
  // shape to leave lying around for the caller that forgets to check first.
  if (!config) return { visible: false, reason: "audience", audience: [] };

  // Who it is for, asked first: a problem nobody has been given is withheld
  // whatever its contest is doing, and the answer does not change with time.
  if (!inAudience(config.visibleTo, viewer)) {
    return { visible: false, reason: "audience", audience: config.visibleTo };
  }

  // Then when. A contest that has started releases its problems; one that has
  // not holds them until it does, which is what lets a round be merged and
  // deployed a week early without leaking.
  let embargo: { contestSlug: string; opensAt: Date } | null = null;

  for (const contest of contestsUsing(slug)) {
    if (contestPhase(contest, now) !== "upcoming") {
      return { visible: true };
    }

    // Keep the earliest opening: that is when the problem stops being secret.
    if (!embargo || contest.startsAt < embargo.opensAt) {
      embargo = { contestSlug: contest.slug, opensAt: contest.startsAt };
    }
  }

  return embargo
    ? { visible: false, reason: "embargo", ...embargo }
    : { visible: true };
}

function viewOf(config: ProblemConfig, viewer: Viewer, now: Date): ProblemView {
  const gate = problemVisibility(config.slug, viewer, now);
  return { config, gate, open: gate.visible && !config.retired };
}

/**
 * Every problem this viewer may be shown.
 *
 * A holder of `problem.viewAll` gets the gated and the retired ones too,
 * carrying their reason, so a console can mark them rather than pretend they
 * are absent. Everyone else gets only what is open to them — there is no
 * argument that widens that.
 *
 * Retired problems drop out of this list while staying readable through
 * `problemFor`, which is the whole shape of retirement: gone from the catalogue,
 * still there for whoever competed on it.
 */
export function problemsFor(viewer: Viewer, now = new Date()): ProblemView[] {
  const override = viewer.can("problem.viewAll");
  return allProblems()
    .map((config) => viewOf(config, viewer, now))
    .filter((entry) => override || entry.open);
}

/**
 * One problem, or `undefined` when this viewer may not have it.
 *
 * Undefined rather than a thrown error or a null-object: the caller's next
 * move is almost always `notFound()`, and 404 is the right answer anyway —
 * confirming that a slug exists but is embargoed tells a player how many
 * problems the round has and what they are called.
 */
export function problemFor(
  slug: string,
  viewer: Viewer,
  now = new Date(),
): ProblemView | undefined {
  const config = problemBySlug(slug);
  if (!config) return undefined;

  // Gated on visibility alone: a retired problem is still readable by whoever
  // it was written for. What retirement withholds is `open`, not the statement.
  const view = viewOf(config, viewer, now);
  if (!view.gate.visible && !viewer.can("problem.viewAll")) return undefined;

  return view;
}

/**
 * How a submission record should name the problem it points at.
 *
 * Three states, and the two pages that show submissions used to disagree about
 * them: the list joined the mirror table and printed a stale title, the detail
 * page read the registry and fell back to the raw slug. Same problem, two
 * answers, both linking to a page that 404s.
 *
 * `fallbackTitle` is the snapshot in `problems`, which is all that is left once
 * a directory is deleted for real.
 */
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

/**
 * Problems whose two switches disagree.
 *
 * An empty `visibleTo` says "nobody, ever" while being in a contest says "from
 * the start time". Audience wins, so such a problem stays dark through its own
 * round — almost never what the author meant. Reported at startup rather than
 * enforced, because refusing to boot over it would turn a wording preference
 * into an outage.
 *
 * Retirement gets the same treatment, and for a sharper version of the same
 * reason: refusing to boot would block the deploy that retires a problem
 * mid-round, which is exactly when somebody has found a fault in it and wants
 * submissions to stop. A contest that has already ended is not reported at
 * all — carrying retired problems is the normal end state for one.
 */
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
      (contest) => contestPhase(contest, now) !== "ended",
    );
    if (unfinished.length === 0) continue;

    warnings.push(
      `题目 "${problem.slug}" 已下架，但比赛 ${unfinished.map((c) => c.slug).join("、")} 还没结束；` +
        `题面仍然可读，但这些比赛期间没有人能提交它。`,
    );
  }

  return warnings;
}

/**
 * Re-exported so a page never needs the raw registry at all.
 *
 * A statement is only ever loaded after `problemFor` has already allowed the
 * problem through, and importing it from here keeps that the obvious order.
 */
export { loadStatement } from "./registry";

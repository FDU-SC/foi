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

/**
 * How anything that renders to a person obtains a problem.
 *
 * Everything in this repository ships on deploy, and a contest's problems have
 * to be in the repository before the contest starts. Without a gate, merging
 * next week's contest leaks next week's problems.
 *
 * The gate lives at the point of retrieval rather than at each call site, and
 * that placement is the whole design. Filtering after the registry hands a
 * problem out is a rule somebody has to remember, and nothing about asking a
 * registry for problems suggests a second step exists — so it gets missed on
 * the seventh page.
 *
 * So there is no way to ask this module for a problem without saying who is
 * asking. The raw accessors still exist in `./registry` for the callers that
 * legitimately need every problem regardless of viewer — the mirror sync, the
 * drift report, load-time validation — and they are named to make reaching for
 * them a visible choice in a diff.
 *
 * This module may import both registries and the contest gate; none of them
 * may import it. `lib/contests/registry.ts` already depends on
 * `lib/problems/registry.ts` for its load-time checks, and both build eagerly
 * at module load, so a back edge from either would be a cycle evaluated during
 * startup. `lib/contests/access.ts` reaches only those two, which is what lets
 * `reachableViaContest` below ask it a question in the other direction.
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

/**
 * What let a viewer have a problem whose gate says no.
 *
 * Two paths reach past `problemVisibility`, and a reader has to be told which
 * one they came in on: a proofreader is looking at something not released
 * yet, while somebody here through a round is looking at something released to
 * other people and not to them. The statement page prints a different notice
 * for each, and asking the capability there instead would put a permission
 * question back in a page — the thing this module exists to stop.
 */
export type ProblemOverride = "problem.viewAll" | "contest";

/** A problem plus why it is, or is not, open to the viewer who asked. */
export interface ProblemView {
  config: ProblemConfig;

  /** Who may read it. `retired` deliberately does not participate. */
  gate: Visibility;

  /**
   * Which override carried this viewer past `gate`, or null.
   *
   * Always null when `gate.visible` — nothing had to be overridden. Non-null
   * is the case `problemFor` returns a view for a gate that refused, and it
   * never widens `open`: both overrides read the statement and neither may
   * submit.
   */
  reachedVia: ProblemOverride | null;

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
    if (hasContestStarted(contest, now)) {
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

/**
 * The second override path, and deliberately the exact shape of the first.
 *
 * "Whoever can see a contest can see every one of its problems" holds on the
 * other two axes already — `audienceCovers` enforces it at load, and a started
 * round releases its problems — and the one hole left is the capability axis,
 * which the load-time check cannot see: `contest.viewAll` reaches past a
 * round's `visibleTo`, and nothing then puts its holder in the audience of the
 * problems inside. Closing it at retrieval rather than filtering at render is
 * the same choice `lib/permissions/audience.ts` argues for.
 *
 * `hasContestStarted` is load-bearing and must not be dropped. Without it a
 * competitor who *is* in an unstarted round's audience matches — `contestFor`
 * answers for them, because they are in the audience — and the embargo comes
 * off for exactly the people it exists to hold it on. With it there is also no
 * need to look at whether the gate said `audience` or `embargo`: an embargo
 * means every round using the problem is still upcoming, which this has
 * already excluded.
 *
 * `contestFor(...) !== undefined` rather than `viewer.can("contest.viewAll")`,
 * because the former is what "may have this contest" is spelled as here.
 * Naming the capability would restate `contestFor`'s condition, and the next
 * way of reaching a contest would not be picked up.
 */
function reachableViaContest(slug: string, viewer: Viewer, now: Date): boolean {
  return contestsUsing(slug).some(
    (contest) =>
      hasContestStarted(contest, now) &&
      contestFor(contest.slug, viewer) !== undefined,
  );
}

/**
 * Which override applies, asked only once the gate has refused.
 *
 * `problem.viewAll` first, so somebody holding both is told the more specific
 * thing: they are looking at material that has not been released to anyone,
 * which is a different situation from looking at material released to other
 * people.
 */
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

/**
 * Everything a view holds except the override, which is the expensive half.
 *
 * Split out because the two are asked for at different times: `problemFor`
 * needs both at once, while `problemsFor` has a filter to apply first and no
 * reason to price the entries it is about to throw away.
 */
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
 *
 * The contest override is deliberately not the same: a problem reached only
 * because its round can be seen is readable at its own URL and stays out of
 * the catalogue, because the filter below is `open`, which such a problem is
 * not. Listing it would put a problem in somebody's 题库 that they cannot
 * submit to and were never given.
 *
 * Which is also why the override is resolved after the filter rather than
 * during the mapping: `reachableViaContest` walks every round a problem
 * appears in and puts each through the contest gate, and during the mapping it
 * would run once per gate-refused problem on a list that then drops every one
 * of them. Nothing surviving the filter needs the expensive answer anyway — an
 * `open` entry has a gate that said yes, and a refused one is only here
 * because the viewer holds `problem.viewAll`, which `overrideFor` checks
 * first.
 */
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

/**
 * One problem, or `undefined` when this viewer may not have it.
 *
 * Undefined rather than a thrown error or a null-object: the caller's next
 * move is almost always `notFound()`, and 404 is the right answer anyway —
 * confirming that a slug exists but is embargoed tells a player how many
 * problems the round has and what they are called.
 *
 * Two overrides get past a gate that said no, and `reachedVia` says which.
 * Neither touches `gate` or `open`, so both read the statement and neither may
 * submit or start a container.
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
  if (!view.gate.visible && view.reachedVia === null) return undefined;

  return view;
}

/**
 * How a submission record should name the problem it points at.
 *
 * Three states, computed here so that every page showing submissions gives the
 * same answer: joining the mirror table prints a stale title, reading the
 * registry alone falls back to the raw slug, and both link to a page that
 * 404s.
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

/**
 * Re-exported so a page never needs the raw registry at all.
 *
 * A statement is only ever loaded after `problemFor` has already allowed the
 * problem through, and importing it from here keeps that the obvious order.
 */
export { loadStatement } from "./registry";

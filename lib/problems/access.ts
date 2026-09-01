import { authorize } from "@/lib/authz/engine";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { Viewer } from "@/lib/authz/viewer";
import { contestProblemRef, contestProblemRefsIn } from "@/lib/contests/refs";

/** The policy that reads the contest's `visibleTo`. Reaching a problem any
 * other way is a preview of something not yet public. */
const AUDIENCE = "builtin:contest-problem-audience";

export interface ProblemView {
  ref: ContestProblemRef;

  /** Reached through some policy other than the audience one. */
  preview: boolean;
}

function viewOf(
  ref: ContestProblemRef,
  viewer: Viewer,
  now: Date,
): ProblemView | undefined {
  const decision = authorize("problem.read", ref, viewer, { now });
  if (!decision.allow) return undefined;

  return { ref, preview: decision.via !== AUDIENCE };
}

/**
 * One contest's problem set, as this viewer may see it.
 *
 * A problem is a belonging of the contest that carries it, so this is the only
 * listing there is: there is no catalogue above the contests to fall back to.
 */
export function problemsFor(
  contestSlug: string,
  viewer: Viewer,
  now = new Date(),
): ProblemView[] {
  return contestProblemRefsIn(contestSlug).flatMap(
    (ref) => viewOf(ref, viewer, now) ?? [],
  );
}

export function problemFor(
  contestSlug: string,
  problemSlug: string,
  viewer: Viewer,
  now = new Date(),
): ProblemView | undefined {
  const ref = contestProblemRef(contestSlug, problemSlug);
  return ref ? viewOf(ref, viewer, now) : undefined;
}

export type ProblemStatus =
  | { kind: "live"; title: string }
  | { kind: "gone"; title: string };

/**
 * What to call a problem a submission points at. It is "gone" once the contest
 * stops carrying it, which is the only way a problem leaves circulation.
 */
export function problemStatus(
  contestSlug: string,
  problemSlug: string,
  fallbackTitle: string,
): ProblemStatus {
  const ref = contestProblemRef(contestSlug, problemSlug);
  if (!ref) return { kind: "gone", title: fallbackTitle };
  return { kind: "live", title: ref.problem.title };
}

export { loadStatement } from "./registry";

import type { ActionId } from "@/lib/authz/actions";
import { allPolicies } from "@/lib/authz/registry";
import type { ContestProblemRef } from "@/lib/authz/resources";
import type { CompiledPolicy } from "@/lib/authz/types";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { contestProblemRefs } from "@/lib/contests/refs";
import { allContests } from "@/lib/contests/registry";
import type { ContestConfig, ContestProblemConfig } from "@/lib/contests/types";
import {
  acceptsSubmissions,
  hasContestEnded,
  hasContestStarted,
  showsStatements,
} from "@/lib/contests/types";
import {
  isInlineBackend,
  type ExternallyJudged,
} from "@/lib/problems/types";

function required<T>(value: T | undefined, shape: string): T {
  if (value === undefined) {
    throw new Error(
      `内核测试需要 content/ 里有${shape}。` +
        `完整清单见 test/content-shapes.ts，上游那套示例 content 每一条都满足。`,
    );
  }
  return value;
}

function grantedGroups(entry: CompiledPolicy): readonly string[] {
  const principal = entry.principal;
  if (!principal) return [];
  if ("group" in principal) return [principal.group];
  if ("anyGroup" in principal) return principal.anyGroup;
  return [];
}

/** A group some policy grants this action to, unconditionally. */
export function groupWith(action: ActionId): string {
  const found = allPolicies()
    .filter(
      (entry) =>
        entry.effect === "permit" &&
        !entry.when &&
        entry.actions.includes(action),
    )
    .flatMap(grantedGroups)[0];

  return required(found, `一条无条件放行 ${action} 给某个用户组的策略`);
}

export function viewerWith(action: ActionId, uid = 99): Viewer {
  return viewerFor({ uid, groups: [groupWith(action)] });
}

function groupsGranted(action: ActionId): Set<string> {
  return new Set(
    allPolicies()
      .filter(
        (entry) =>
          entry.effect === "permit" &&
          !entry.when &&
          entry.actions.includes(action),
      )
      .flatMap(grantedGroups),
  );
}

/**
 * Someone a policy lets in but stops short of: proof that the layers compose,
 * and the fixture behind "运维台打得开，表却是空的".
 */
export function viewerAllowedOnly(
  granted: ActionId,
  withheld: ActionId,
  uid = 98,
): Viewer {
  const blocked = groupsGranted(withheld);
  const group = [...groupsGranted(granted)].find((id) => !blocked.has(id));

  return viewerFor({
    uid,
    groups: [required(group, `一个能 ${granted} 但不能 ${withheld} 的用户组`)],
  });
}

export function contestWithGroupEntry(): {
  contest: ContestConfig;
  entry: ContestProblemConfig;
  group: string;
} {
  const contest = required(
    allContests().find(
      (candidate) =>
        candidate.participants.mode === "group" &&
        candidate.problems[0]?.rateLimit !== undefined,
    ),
    "一场按 group 限制参赛、且第一道题覆盖了 rateLimit 的比赛",
  );

  const participants = contest.participants as { mode: "group"; group: string };
  return {
    contest,
    entry: contest.problems[0]!,
    group: participants.group,
  };
}

function refWhere(
  predicate: (ref: ContestProblemRef) => boolean,
  shape: string,
): ContestProblemRef {
  return required(contestProblemRefs().find(predicate), shape);
}

/**
 * A problem anyone can open and submit to whatever the clock says: an open
 * round whose window is wide enough to cover the real `now`.
 *
 * Route tests need this — a handler reads the system clock, so a fixture round
 * pinned to a past window would refuse them for the wrong reason.
 */
export function openContestProblem(now = new Date()): ContestProblemRef {
  return refWhere(
    (ref) =>
      ref.contest.visibleTo === undefined &&
      ref.contest.participants.mode === "open" &&
      acceptsSubmissions(ref.contest, now),
    "一场对所有人开放、任何人都能参加、且此刻正在收题的比赛里的一道题",
  );
}

/** The same, narrowed to a problem an external backend judges. */
export interface ExternalProblemRef extends ContestProblemRef {
  problem: ExternallyJudged;
}

export function openExternalProblem(now = new Date()): ExternalProblemRef {
  const ref = refWhere(
    (candidate) =>
      candidate.contest.visibleTo === undefined &&
      candidate.contest.participants.mode === "open" &&
      acceptsSubmissions(candidate.contest, now) &&
      !isInlineBackend(candidate.problem.backend) &&
      Object.keys(candidate.problem.backend.actions).length > 0,
    "一场此刻开放的比赛里、一道由后端评测且声明了交互动作的题",
  );

  return ref as ExternalProblemRef;
}

/** A problem in a round the clock has not reached yet. */
export function upcomingProblem(now = new Date()): ContestProblemRef {
  return refWhere(
    (ref) =>
      ref.contest.visibleTo?.length !== 0 &&
      !hasContestStarted(ref.contest, now),
    "一场尚未开始、且对某个受众可见的比赛里的一道题",
  );
}

/** A problem in a round whose audience covers nobody. */
export function stagedProblem(): ContestProblemRef {
  return refWhere(
    (ref) => ref.contest.visibleTo?.length === 0,
    "一场 visibleTo 为空数组的比赛里的一道题",
  );
}

/** Readable after the fact, but taking no more work. */
export function archivedProblem(now = new Date()): ContestProblemRef {
  return refWhere(
    (ref) =>
      hasContestEnded(ref.contest, now) &&
      showsStatements(ref.contest, now) &&
      !acceptsSubmissions(ref.contest, now),
    "一场已经结束、题面仍可读但不再收题的比赛里的一道题",
  );
}

/** Finished, and still collecting. */
export function upsolveProblem(now = new Date()): ContestProblemRef {
  return refWhere(
    (ref) =>
      hasContestEnded(ref.contest, now) && acceptsSubmissions(ref.contest, now),
    "一场已经结束但仍然收题的比赛里的一道题",
  );
}

/** Finished, and gone: the round took its statements with it. */
export function sealedProblem(now = new Date()): ContestProblemRef {
  return refWhere(
    (ref) =>
      hasContestEnded(ref.contest, now) && !showsStatements(ref.contest, now),
    "一场已经结束、且连题面都收起来了的比赛里的一道题",
  );
}

/** Judged in-process, in a round anyone can submit to right now. */
export function inlineProblem(now = new Date()): ContestProblemRef {
  return refWhere(
    (ref) =>
      ref.contest.visibleTo === undefined &&
      ref.contest.participants.mode === "open" &&
      acceptsSubmissions(ref.contest, now) &&
      isInlineBackend(ref.problem.backend),
    "一场此刻开放的比赛里的一道内联判题的题",
  );
}

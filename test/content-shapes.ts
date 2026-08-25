import { listGroups } from "@/lib/auth/groups";
import type { Capability } from "@/lib/auth/policy";
import { viewerFor, type Viewer } from "@/lib/auth/viewer";
import { allContests } from "@/lib/contests/registry";
import { enrollmentPolicy } from "@/lib/enrollment/registry";
import { listRulesets } from "@/lib/standings/registry";
import type { ContestConfig, ContestProblemConfig } from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import type { ExternallyJudged, ProblemConfig } from "@/lib/problems/types";

/**
 * What the kernel's own suites need `content/` to contain, found by shape.
 *
 * The gates, the action whitelist and the submission path are all written
 * against the live registries, and deliberately: a fixture registry would
 * happily agree with a gate that had drifted, and would not catch a contest
 * file that forgot a problem. The tests were reaching into the registry by
 * name to get there — `contestBySlug("demo-acm")`, `roulette-daily`,
 * `traditional` — which quietly made one competition's problem set part of the
 * platform's test suite. Swap `content/` and the kernel stopped compiling.
 *
 * So the dependency stays and the names go. Each finder below describes a
 * *shape*, throws a message naming that shape when nothing matches, and points
 * at `test/content-skeleton/`, which is the reference content that satisfies
 * all of them. A deployment whose content is missing one gets told which
 * mechanism is going untested rather than which slug is missing.
 *
 * Facts about one deployment's own content — that its demo round charges
 * twenty penalty minutes, that its warmup is retired — belong in
 * `content/deployment.test.ts` instead.
 */

function required<T>(value: T | undefined, shape: string): T {
  if (value === undefined) {
    throw new Error(
      `内核测试需要 content/ 里有${shape}。` +
        `参考 test/content-skeleton/，那份骨架满足所有这类要求。`,
    );
  }
  return value;
}

/** A group this deployment grants some capability to. */
export function groupWith(capability: Capability): string {
  const group = listGroups().find((entry) =>
    entry.capabilities.includes(capability),
  );
  return required(group, `一个带 ${capability} 能力的用户组`).id;
}

/** A viewer holding one capability, by way of whichever group grants it. */
export function viewerWith(capability: Capability, handle = "cap-holder"): Viewer {
  return viewerFor({ handle, groups: [groupWith(capability)] });
}


/**
 * A round that restricts entry to a group, with a per-problem throttle
 * override on its first problem.
 *
 * One finder for both because the gate suite needs them together: the override
 * is what proves the throttle is read off the contest entry rather than off the
 * problem, and the group is what separates `not-entered` from the refusals
 * around it.
 */
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

  // Narrowed by the predicate above; TypeScript cannot see through `find`.
  const participants = contest.participants as { mode: "group"; group: string };
  return {
    contest,
    entry: contest.problems[0]!,
    group: participants.group,
  };
}

/** A scoring format that implements the freeze window. */
export function freezingRuleset() {
  return required(
    listRulesets().find((ruleset) => ruleset.supportsFreeze),
    "一种 supportsFreeze 的赛制",
  );
}

/**
 * A handle registration will not hand out.
 *
 * Needed because the rule that may grant a privileged group names handles, and
 * that is only safe if those names can be held back — so a deployment with an
 * empty list has a hole rather than a preference.
 */
export function reservedHandle(): string {
  return required(enrollmentPolicy.reservedHandles[0], "至少一个保留用户名");
}

/** A problem taken out of service but still readable. */
export function retiredProblem(): ProblemConfig {
  return required(
    allProblems().find((config) => config.retired),
    "一道 retired 的题目",
  );
}

/** A problem judged by a backend rather than in this process. */
export function externalProblem(): ExternallyJudged {
  return required(
    externallyJudged().find((problem) => !problem.retired),
    "一道在役的、由后端评测的题目",
  );
}

/** A problem judged in this process, so submitting to it settles synchronously. */
export function inlineProblem(): ProblemConfig {
  return required(
    allProblems().find(
      (config) => !config.retired && "kind" in config.backend,
    ),
    "一道内联判题的题目",
  );
}

/** A problem declaring at least one interactive action, with the action's name. */
export function problemWithAction(): { problem: ExternallyJudged; action: string } {
  const problem = required(
    externallyJudged().find(
      (candidate) =>
        !candidate.retired && Object.keys(candidate.backend.actions).length > 0,
    ),
    "一道声明了 actions 的在役题目",
  );
  return { problem, action: Object.keys(problem.backend.actions)[0]! };
}

/**
 * A problem the given contest does not list, open to an ordinary visitor at
 * `now`.
 *
 * Naming it alongside the contest is a mismatch rather than a permission
 * question, which is the distinction the gate suite is pinning.
 */
export function publicProblemOutside(
  contest: ContestConfig,
  now: Date,
): ProblemConfig {
  const listed = new Set(contest.problems.map((entry) => entry.slug));
  return required(
    problemsFor(viewerFor(null), now)
      .map((view) => view.config)
      .find((config) => !listed.has(config.slug)),
    `一道不属于「${contest.title}」、且当时对所有人可见的题目`,
  );
}

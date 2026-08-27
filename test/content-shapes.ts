import { listGroups } from "@/lib/permissions/groups";
import type { Capability } from "@/lib/permissions/policy";
import { viewerFor, type Viewer } from "@/lib/permissions/viewer";
import { allContests } from "@/lib/contests/registry";
import type { ContestConfig, ContestProblemConfig } from "@/lib/contests/types";
import { problemsFor } from "@/lib/problems/access";
import { allProblems, externallyJudged } from "@/lib/problems/registry";
import type { ExternallyJudged, ProblemConfig } from "@/lib/problems/types";

function required<T>(value: T | undefined, shape: string): T {
  if (value === undefined) {
    throw new Error(
      `内核测试需要 content/ 里有${shape}。` +
        `完整清单见 test/content-shapes.ts，上游那套示例 content 每一条都满足。`,
    );
  }
  return value;
}

export function groupWith(capability: Capability): string {
  const group = listGroups().find((entry) =>
    entry.capabilities.includes(capability),
  );
  return required(group, `一个带 ${capability} 能力的用户组`).id;
}

export function viewerWith(capability: Capability, uid = 99): Viewer {
  return viewerFor({ uid, groups: [groupWith(capability)] });
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

export function retiredProblem(): ProblemConfig {
  return required(
    allProblems().find((config) => config.retired),
    "一道 retired 的题目",
  );
}

export function externalProblem(): ExternallyJudged {
  return required(
    externallyJudged().find((problem) => !problem.retired),
    "一道在役的、由后端评测的题目",
  );
}

export function inlineProblem(): ProblemConfig {
  return required(
    allProblems().find(
      (config) => !config.retired && "kind" in config.backend,
    ),
    "一道内联判题的题目",
  );
}

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

import { contestsUsing } from "@/lib/contests/by-problem";
import { hasContestEnded } from "@/lib/contests/types";
import { allProblems } from "./registry";

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

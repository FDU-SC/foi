import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The driver generates each subtask's graphs from a fixed seed, computes the
 * expected dominators with Lengauer-Tarjan and runs the submitted program once
 * per test, freeing a subtask's data before generating the next. argv[1] is the
 * per-test wall-clock limit in milliseconds; the case's time limit only bounds
 * the whole run. The 64 MB stack admits a recursive DFS at n = 2×10^5.
 */
export const problem = {
  slug: "dominator-tree",
  title: "必经之路",
  maxScore: 100,
  backend: makefileJudge({
    files: judgeFiles(
      import.meta.glob(["./code/*", "./code/**/*"], {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ),
    contestant: "contestant.cpp",
    contestantOwnsMain: true,
    build: { target: "all", artifact: "dominator-tree", timeLimitMs: 60000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "全部子任务",
        argv: ["./dominator-tree", "3000"],
        threads: 1,
        timeLimitMs: 70000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 512,
    stackLimitMb: 64,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    tags: ["图论"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

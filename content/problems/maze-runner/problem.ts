import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The driver generates every maze from a fixed seed, computes the expected
 * distance with its own BFS and runs the submitted program once per test, scoring
 * by subtask. argv[1] is the per-test wall-clock limit in milliseconds; the
 * case's time limit only bounds the whole run.
 */
export const problem = {
  slug: "maze-runner",
  title: "迷宫寻路",
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
    build: { target: "all", artifact: "maze-runner", timeLimitMs: 60000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "全部子任务",
        argv: ["./maze-runner", "1000"],
        threads: 1,
        timeLimitMs: 25000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 256,
    stackLimitMb: 8,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    tags: ["图论", "搜索"],
    difficulty: "入门",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

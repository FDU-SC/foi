import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The driver generates every test from a fixed seed, computes the expected move
 * with its own reference solution and runs the submitted program once per test,
 * scoring by subtask. argv[1] is the per-test wall-clock limit in milliseconds;
 * the case's time limit only bounds the whole run.
 */
export const problem = {
  slug: "hanoi-kth",
  title: "汉诺塔 · 第 k 步",
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
    build: { target: "all", artifact: "hanoi-kth", timeLimitMs: 60000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "全部子任务",
        argv: ["./hanoi-kth", "1000"],
        threads: 1,
        timeLimitMs: 40000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 256,
    stackLimitMb: 8,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    tags: ["递归"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

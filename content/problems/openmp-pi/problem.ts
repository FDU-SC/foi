import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The driver times the submitted program and a serial reference built by the
 * same makefile in the same run, checks π within 1e-6 and scores by speedup.
 * argv: n, base, perf, seed. The submission runs 16 threads, which `threads`
 * accounts for in the CPU-time budget.
 */
export const problem = {
  slug: "openmp-pi",
  title: "OpenMP 优化 · π 的数值积分",
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
    build: { target: "all", artifact: "driver", timeLimitMs: 120000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "n = 10^9",
        argv: ["./driver", "1000000000", "50", "50", "1"],
        threads: 16,
        timeLimitMs: 120000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 1024,
    stackLimitMb: 8,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的 OpenMP 优化代码（完整程序，读入 n 并输出 π 近似）",
    tags: ["性能优化", "OpenMP", "并行"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

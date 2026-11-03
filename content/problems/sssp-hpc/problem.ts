import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The submission is one function,
 *
 *   void calculate(uint32_t n, uint32_t m, uint32_t *edges, uint64_t *dis);
 *
 * which the driver links, times and checks against its own reference, scoring
 * base + perf * min(goal / time, 1). argv: n, m, seed, base, perf, goal (ms).
 */
export const problem = {
  slug: "sssp-hpc",
  title: "HPC 单源最短路 · 并行加速",
  maxScore: 50,
  backend: makefileJudge({
    files: judgeFiles(
      import.meta.glob(["./code/*", "./code/**/*"], {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ),
    contestant: "contestant.cpp",
    build: { target: "all", artifact: "sssp", timeLimitMs: 120000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "1e5 点 / 2e5 边",
        argv: ["./sssp", "100000", "200000", "42", "10", "10", "5"],
        threads: 16,
        timeLimitMs: 30000,
        maxScore: 20,
      },
      {
        name: "1e5 点 / 1e6 边",
        argv: ["./sssp", "100000", "1000000", "42", "5", "15", "60"],
        threads: 16,
        timeLimitMs: 30000,
        maxScore: 20,
      },
      {
        name: "1e6 点 / 2e6 边",
        argv: ["./sssp", "1000000", "2000000", "42", "5", "5", "1200"],
        threads: 16,
        timeLimitMs: 60000,
        maxScore: 10,
      },
    ],
    memoryLimitMb: 1024,
    stackLimitMb: 32,
    seed: 42,
  }),
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的实现（实现 calculate，不要写 main）",
    tags: ["性能优化", "OpenMP", "图论", "HPC"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

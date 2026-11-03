import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

const N = 512;
const SEED = 1;
const BASE = 20;

const ARGV = ["./perf-optimize", String(N), String(SEED), String(BASE)];

/**
 * The driver generates the matrices, runs the built-in naive baseline and the
 * submitted program on the same input (one warm-up, best of three timed runs),
 * compares the output byte for byte and scores by speedup. Everything is
 * single-threaded; the makefile refuses -pthread and -fopenmp.
 */
export const problem = {
  slug: "perf-optimize",
  title: "性能优化题示例 · 矩阵乘法",
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
    build: { target: "all", artifact: "perf-optimize", timeLimitMs: 120000, memoryLimitMb: 2048 },
    cases: [
      {
        name: `n=${N}`,
        argv: ARGV,
        threads: 1,
        timeLimitMs: 8000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 1024,
    stackLimitMb: 8,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的优化代码（完整程序，读入矩阵并输出乘积）",
    tags: ["访存", "性能", "SIMD"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

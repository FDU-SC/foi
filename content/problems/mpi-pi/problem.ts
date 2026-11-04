import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/** n, MPI ranks, base score, warm-up runs, timed runs. */
const N = 200000000;
const NP = 4;
const BASE = 50;
const WARMUP = 1;
const TIMED = 3;

const ARGV = ["./driver", String(N), String(NP), String(BASE), String(WARMUP), String(TIMED)];

/**
 * The driver runs the published baseline and the submitted MPI program under
 * `mpirun -np NP`, checks the result against its own reference value and scores
 * by speedup. Each rank is a process with its own CPU-time budget, so `threads`
 * is the rank count.
 */
export const problem = {
  slug: "mpi-pi",
  title: "MPI 优化 · 分布式 π",
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
        name: `n=${N} np=${NP}`,
        argv: ARGV,
        threads: NP,
        timeLimitMs: 30000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 512,
    stackLimitMb: 8,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的 MPI 优化代码（完整程序，读入 n 并输出 π 近似）",
    tags: ["性能优化", "MPI", "并行"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The driver runs the submitted MPI program under mpirun with 4 ranks and
 * expects rank 0 to print PASS after its self-check. Each rank is a process with
 * its own CPU-time budget, so `threads` is the rank count.
 */
export const problem = {
  slug: "ring-allreduce",
  title: "Ring Allreduce · 环形全归约",
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
    build: { target: "all", artifact: "ring-allreduce", timeLimitMs: 120000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "np=4 n=65536",
        argv: ["./ring-allreduce"],
        threads: 4,
        timeLimitMs: 30000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 256,
    stackLimitMb: 8,
    seed: 1,
  }),
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的 MPI ring allreduce 实现（完整程序，自检后输出 PASS）",
    tags: ["分布式", "Allreduce", "MPI", "实现题"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

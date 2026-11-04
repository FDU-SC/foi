import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { makefileJudge } from "@/content/_shared/judges/makefile";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The driver links the submitted solve() against query() and answer(), checks
 * the final answer and scores by the number of queries.
 */
export const problem = {
  slug: "interactive-binary-search",
  title: "交互式二分查找",
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
    build: { target: "all", artifact: "driver", timeLimitMs: 20000, memoryLimitMb: 2048 },
    cases: [
      {
        name: "1000000",
        argv: ["./driver", "1000000"],
        threads: 16,
        timeLimitMs: 3000,
        maxScore: 100,
      },
    ],
    memoryLimitMb: 1024,
    stackLimitMb: 32,
    seed: 42,
  }),
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的实现（实现 solve，不要写 main）",
    tags: ["交互", "二分"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { stdioJudge, type StdioLanguage } from "@/content/_shared/judges/stdio";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

const LANGUAGES: StdioLanguage[] = ["cpp", "python", "java"];

export const problem = {
  slug: "knapsack",
  title: "0-1 背包",
  maxScore: 100,
  backend: stdioJudge({
    files: judgeFiles(
      import.meta.glob(["./code/*", "./code/**/*"], {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ),
    generator: "gen.cpp",
    solution: "std.cpp",
    languages: LANGUAGES,
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    subtasks: [
      { name: "可以爆搜", score: 30, tests: 5 },
      { name: "小容量", score: 30, tests: 5 },
      { name: "大数据", score: 40, tests: 6 },
    ],
  }),
  ui: {
    languages: [...LANGUAGES],
    tags: ["动态规划"],
    difficulty: "进阶",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

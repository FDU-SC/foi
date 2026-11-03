import { judgeFiles } from "@/content/_shared/judges/judge-files";
import { stdioJudge, type StdioLanguage } from "@/content/_shared/judges/stdio";
import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

const LANGUAGES: StdioLanguage[] = ["cpp", "python", "java"];

export const problem = {
  slug: "largest-rectangle",
  title: "最大矩形",
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
      { name: "平方做法可过", score: 30, tests: 5 },
      { name: "中等数据", score: 30, tests: 5 },
      { name: "大数据", score: 40, tests: 6 },
    ],
  }),
  ui: {
    languages: [...LANGUAGES],
    tags: ["单调栈"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

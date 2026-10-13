import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import { judgeFiles } from "@/content/_shared/judge-files";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * 判题机的整套文件来自 ./code/，不再写成字符串。
 *
 * 理由与用法见 `content/_shared/judge-files.ts`：真文件才有真 Tab，C++ 里的
 * backslash-n 也才是两个字符而不需要写成四个，编辑器还能给出 makefile / C++
 * 的高亮，而不是让人把转义规则背下来。
 *
 * glob 写成两个模式，是因为 `**` 能否跨零层属于 glob 方言的细节而非保证：
 * `./code/*` 管直接子文件，`./code/**\/*` 管任意深度，两者重叠由 judgeFiles
 * 去重。参数必须写成字面量——`import.meta.glob` 要能静态解析它。
 *
 * `contestant.cpp` 只是占位：评测时它的内容会被 payload.source 覆盖，在这里
 * 写什么都不影响判分，但必须存在，否则 makefile 会找不到它。
 */
const files = judgeFiles(
  // `query`/`import` 是给 Vitest 的：那边没有 turbopack 规则，glob 会直接把
  // driver.cpp 当 JS 解析，报 "Expected `in` but found `<`"。`?raw` 让 Vite 交出
  // 文本；Turbopack 会忽略这两个选项、照旧走 `**/code/**` 那条规则。两种产物
  // judgeFiles 都认（见 judge-files.ts 的 decode）。
  import.meta.glob(["./code/*", "./code/**/*"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  { contestant: "contestant.cpp" },
);

/**
 * 测试点取自 hpcgame 官方表格，但**规模缩小了**。
 *
 * 官方那七行最大到 n=1e7 / m=1e9 / 100 秒上限。判题机的参考解在 m=1e9 时
 * 需要约 20 GB——光驱动传给 calculate() 的边表就是 m × 12 字节，12 GB——
 * 所以 16 GB 的宿主跑不动那一档。这里保留前三档的结构与 base/perf/goal
 * 语义，规模降到秒级可完成（实测峰值 108 MB）。宿主内存够了再按官方
 * 表格替换 CASES 即可，config 结构不用动。
 */
const CASES = [
  {
    name: "1e6 点 / 2e6 边",
    argv: ["./sssp", "1000000", "2000000", "42", "10", "120"],
    threads: 16,
    timeLimitMs: 60000,
    maxScore: 10,
  },
  {
    name: "1e7 点 / 2e7 边",
    argv: ["./sssp", "10000000", "20000000", "42", "20", "1000"],
    threads: 16,
    timeLimitMs: 30000,
    maxScore: 20,
  },
  {
    name: "1e7 点 / 1e7 边",
    argv: ["./sssp", "10000000", "10000000", "42", "20", "700"],
    threads: 16,
    timeLimitMs: 30000,
    maxScore: 20,
  },
];

export const problem = {
  slug: "sssp-hpc",
  title: "HPC 单源最短路 · 并行加速",
  maxScore: 50,
  backend: {
    id: "interactive",
    config: {
      files,
      makefile: "makefile",
      contestant: "contestant.cpp",
      build: {
        target: "all",
        artifact: "sssp",
        wallMs: 120000,
        memoryMb: 4096,
        threads: 16,
      },
      run: {
        argv: ["./sssp", "1000000", "2000000", "42", "20", "5000"],
      },
      result: { required: true },
      cases: CASES.map((item) => ({
        name: item.name,
        argv: item.argv,
        threads: item.threads,
        timeLimitMs: item.timeLimitMs,
        maxScore: item.maxScore,
      })),
      seed: 42,
      memoryLimitMb: 4096,
      // 每线程 32 MB 栈，足以覆盖深递归解法。判题机据此推导地址空间
      // （1024 + 16×32 + 16 = 1552 MB），所以栈一定装得下。
      stackLimitMb: 128,
    },
  },
  ui: {
    languages: ["cpp"],
    placeholder: "粘贴你的实现（实现 calculate，不要写 main）",
    tags: ["性能优化", "OpenMP", "图论", "HPC"],
    difficulty: "挑战",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

import type { ProblemUi } from "@/content/_shared/ui/ui-config";
import { judgeFiles } from "@/content/_shared/judge-files";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * 判题机的整套文件来自 ./code/：driver.cpp（我们提供、不许改）、checker.cpp（验残差）、
 * gen.cpp（按隐藏种子生成数据）、makefile（编译这三个二进制），以及 contestant.cpp
 * ——选手提交的落点。用法见 `content/_shared/judge-files.ts`。
 *
 * `?raw` 是给 Vitest 的：那边是 Vite，没有 turbopack 规则，glob 会把这些 .cpp 当 JS
 * 解析并报语法错。Turbopack 忽略这两个选项、照旧走 next.config.ts 里那条匹配 code/
 * 的规则。
 */
const files = judgeFiles(
  import.meta.glob(["./code/*", "./code/**/*"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  { contestant: "contestant.cpp" },
);

/**
 * 前 3 档（N=2049/4096/8192），共 50 分。题面还有 N=16384/32768 两档，那两档要
 * 32 核宿主和 20 GB 级内存与磁盘（N=32768 的矩阵本身 8.6 GB），当前 compose 给
 * common 的 /tmp 只有 4 GB，放不下，所以先不加——加的时候照抄下面这行的形状。
 *
 * argv 依次是 [N, 满分成绩 t0(秒), 该点分值 u, 该点的运行时间限制(秒), 隐藏种子]，
 * 与 run.sh 的约定一致。种子取 `${JOB_ID_SHA16}`：数据固定的话，选手可以离线把解
 * 算出来直接交表（N=2049 的解只有 16 KB）。
 *
 * `timeLimitMs` 是判题机给整个测试点的挂钟预算，**不是**题面的时间限制：一个测试点里
 * 还要跑 gen 与 checker，所以它 = 题面限制 + 余量；真正的时间判定由 run.sh 自己做。
 * 余量同时也是 CPU 时间（`ulimit -t` 按 wall × threads 给）的余量，所以别把两者贴平。
 *
 * ## t0 是按**当前评测机**实测标定的
 *
 * 标定方法：拿官方参考解（std/solver.cpp）在判题机上按 run.sh 的方式量（`date` 掐
 * `./solver input output` 整段，含读数据），取多次的中位数再留 ~20% 余量。本机
 * （16 核，`OMP_NUM_THREADS=16`）实测中位数是 0.18 / 1.84 / 11.8 秒，于是 t0 写
 * 0.22 / 2.2 / 14。原题那张表（0.1 / 0.8 / 5.3 秒）是在 `Xeon Platinum 8358`（32 核）
 * 上标定的，换宿主必须重新标定，否则满分谁也拿不到或者白送。
 *
 * 这台机器没有 cpuset 钉核，同一配置重复测有 ±10~20% 的抖动（见过一次 2× 的异常值），
 * 所以 t0 留了余量；要更稳就给容器钉核并把 `FOI_RUNNER_CAPACITY` 设成 1。
 */
const CASES = [
  {
    name: "N = 2049",
    argv: ["2049", "0.22", "10", "0.7", "${JOB_ID_SHA16}"],
    threads: 16,
    timeLimitMs: 8700,
    maxScore: 10,
  },
  {
    name: "N = 4096",
    argv: ["4096", "2.2", "20", "7", "${JOB_ID_SHA16}"],
    threads: 16,
    timeLimitMs: 15000,
    maxScore: 20,
  },
  {
    name: "N = 8192",
    argv: ["8192", "14", "20", "45", "${JOB_ID_SHA16}"],
    threads: 16,
    timeLimitMs: 53000,
    maxScore: 20,
  },
];

export const problem = {
  slug: "lu",
  title: "LU 分解",
  maxScore: 50,
  backend: {
    id: "common",
    config: {
      files,
      script: "run.sh",
      contestant: "contestant.cpp",
      cases: CASES,
      // 判题机按它给整个脚本设 ulimit -v，并额外加上 threads × stackLimitMb 的栈
      // （LU 不需要大栈，所以用默认的 8 MB；32 个线程就是 256 MB）。一次只有一个
      // 进程在跑：N=8192 的矩阵 512 MB，gen 与 solver 各自持有一份。
      memoryLimitMb: 1536,
      // N=8192 的输入是 512 MB（8192² × 8 字节），远超判题机默认的 128 MB 单文件上限；
      // 不写这一行 gen 会死在 SIGXFSZ 上，报出来是"生成数据失败"。
      maxFileMb: 1024,
    },
  },
  ui: {
    languages: ["cpp"],
    tags: ["性能优化", "线性代数"],
    difficulty: "挑战",
    placeholder: "粘贴你的实现：void my_solver(int n, double *A, double *b)，不要写 main",
  } satisfies ProblemUi,
} satisfies ProblemConfigInput;

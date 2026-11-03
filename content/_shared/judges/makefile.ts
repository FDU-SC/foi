import "server-only";
import SCRIPT from "./scripts/makefile.sh?raw";
import type { JudgeFile } from "./judge-files";

const SCRIPT_PATH = "foi-make.sh";

const PLACEHOLDER = "// 评测时由选手提交覆盖\n";

export interface MakefileCase {
  name: string;
  /** The run command, e.g. `["./driver", "1000"]`. */
  argv: string[];
  /** Threads or MPI ranks; scales the CPU-time budget and the address space. */
  threads?: number;
  timeLimitMs: number;
  maxScore: number;
}

export interface MakefileJudgeOptions {
  /** The makefile, the driver and anything else the build needs. */
  files: JudgeFile[];
  /** Path the submission is written to. Added as a placeholder if `files` lacks it. */
  contestant: string;
  /**
   * Whether the submission is a whole program. Defaults to false: it is a
   * translation unit linked into the problem's driver, and one that defines
   * `main` is refused before the build.
   */
  contestantOwnsMain?: boolean;
  build: {
    /** `make` target; the makefile's default goal when omitted. */
    target?: string;
    /** File the build must produce. Its absence disrupts the submission. */
    artifact: string;
    /** Added to the first case's time limit, which is where the build runs. */
    timeLimitMs: number;
    /** Address space for the build. Each case's run is held to its own budget. */
    memoryLimitMb: number;
  };
  cases: MakefileCase[];
  /** Data budget of one run. */
  memoryLimitMb: number;
  stackLimitMb?: number;
  /** `"unbounded"` for runtimes that reserve a large address space: MPI, CUDA. */
  addressSpace?: "bounded" | "unbounded";
  seed?: number;
}

const DEFAULT_STACK_MB = 8;

/**
 * A problem whose makefile builds a driver that runs and scores the submission,
 * as a `common` backend: `foi-make.sh` builds once per submission and then runs
 * each case's command, whose `FOI_RESULT` line is the case's result.
 */
export function makefileJudge(options: MakefileJudgeOptions) {
  const stackLimitMb = options.stackLimitMb ?? DEFAULT_STACK_MB;
  const files = options.files.some((file) => file.path === options.contestant)
    ? options.files
    : [...options.files, { path: options.contestant, content: PLACEHOLDER }];

  return {
    id: "common",
    config: {
      files: [...files, { path: SCRIPT_PATH, content: SCRIPT }],
      script: SCRIPT_PATH,
      contestant: options.contestant,
      result: { required: true },
      cases: options.cases.map((testCase, index) => {
        const threads = testCase.threads ?? 1;
        const runAddressSpace =
          options.addressSpace === "unbounded"
            ? "unbounded"
            : String((options.memoryLimitMb + threads * stackLimitMb + 16) * 1024);
        return {
          name: testCase.name,
          argv: [
            String(testCase.maxScore),
            runAddressSpace,
            options.contestantOwnsMain ? "1" : "0",
            options.build.target ?? "-",
            options.build.artifact,
            options.contestant,
            ...testCase.argv,
          ],
          threads,
          timeLimitMs:
            index === 0 ? testCase.timeLimitMs + options.build.timeLimitMs : testCase.timeLimitMs,
          maxScore: testCase.maxScore,
        };
      }),
      memoryLimitMb: Math.max(options.memoryLimitMb, options.build.memoryLimitMb),
      stackLimitMb,
      ...(options.addressSpace === undefined ? {} : { addressSpace: options.addressSpace }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    },
  };
}

import "server-only";
import SCRIPT from "./scripts/stdio.py?raw";
import type { JudgeFile } from "./judge-files";

const SCRIPT_PATH = "foi-stdio.py";
const SPEC_PATH = "foi-stdio.json";

/** What `stdio.py` knows how to compile and run. */
export type StdioLanguage = "c" | "cpp" | "python" | "java";

/** Largest time multiplier in `stdio.py` (Python). */
const SLOWEST_LANGUAGE = 3;

/** Compiling the submission, the generator and the reference solution. */
const COMPILE_BUDGET_MS = 90_000;

/** Running the generator and the reference solution for one test. */
const PRODUCE_BUDGET_MS = 20_000;

export interface StdioSubtask {
  name: string;
  score: number;
  /** Number of tests; the generator is asked for tests 1 to this. */
  tests: number;
}

export interface StdioJudgeOptions {
  /** Must contain `generator` and `solution`. */
  files: JudgeFile[];
  /**
   * C++ source. `generator <subtask> <test> <seed>`, 1-based, prints one test's
   * input; it must be deterministic.
   */
  generator: string;
  /** C++ source. Reads a test's input and prints the expected output. */
  solution: string;
  languages: StdioLanguage[];
  /** Per test, for C and C++. Python and Java get a multiple of it. */
  timeLimitMs: number;
  memoryLimitMb: number;
  subtasks: StdioSubtask[];
  seed?: number;
}

/**
 * A problem judged by comparing a submission's standard output with a reference
 * solution's, test by test, as a `common` backend. Each subtask is one case; the
 * tests are generated while judging, so no testdata is stored.
 */
export function stdioJudge(options: StdioJudgeOptions) {
  for (const path of [options.generator, options.solution]) {
    if (!options.files.some((file) => file.path === path)) {
      throw new Error(`stdioJudge：files 里没有 ${path}`);
    }
  }

  const spec = {
    generator: options.generator,
    solution: options.solution,
    languages: options.languages,
    timeLimitMs: options.timeLimitMs,
    memoryLimitMb: options.memoryLimitMb,
    seed: options.seed ?? 1,
    subtasks: options.subtasks,
  };

  return {
    id: "common",
    config: {
      files: [
        ...options.files,
        { path: SCRIPT_PATH, content: SCRIPT },
        { path: SPEC_PATH, content: JSON.stringify(spec) },
      ],
      script: SCRIPT_PATH,
      shell: "python3",
      result: { required: true },
      cases: options.subtasks.map((subtask, index) => ({
        name: subtask.name,
        argv: [String(index)],
        timeLimitMs:
          (index === 0 ? COMPILE_BUDGET_MS : 0) +
          subtask.tests * (options.timeLimitMs * SLOWEST_LANGUAGE + PRODUCE_BUDGET_MS),
        maxScore: subtask.score,
      })),
      // The script sets each run's own limits; the JVM cannot start under RLIMIT_AS.
      addressSpace: "unbounded",
      memoryLimitMb: options.memoryLimitMb,
      stackLimitMb: options.memoryLimitMb,
    },
  };
}

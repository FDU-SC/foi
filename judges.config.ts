/**
 * Where each judge lives.
 *
 * A problem's `judge.id` selects an entry here. Adding a judge means adding a
 * key — the kernel neither knows nor cares what the judge does with the
 * payload it forwards.
 */
export interface JudgeEndpoint {
  url: string;
  /** Falls back to FOI_JUDGE_SECRET when a judge has no dedicated secret. */
  secret?: string;
  /** Milliseconds to wait for the judge to acknowledge a dispatch. */
  timeoutMs?: number;
}

export const judges: Record<string, JudgeEndpoint> = {
  traditional: {
    url: process.env.FOI_JUDGE_TRADITIONAL_URL ?? "http://localhost:4100",
  },
  "flag-checker": {
    url: process.env.FOI_JUDGE_FLAG_CHECKER_URL ?? "http://localhost:4100",
  },
  "output-only": {
    url: process.env.FOI_JUDGE_OUTPUT_ONLY_URL ?? "http://localhost:4100",
  },
  interactive: {
    url: process.env.FOI_JUDGE_INTERACTIVE_URL ?? "http://localhost:4100",
  },
  performance: {
    url: process.env.FOI_JUDGE_PERFORMANCE_URL ?? "http://localhost:4100",
  },
};

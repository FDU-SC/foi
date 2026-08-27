import type { ProblemViews } from "@/lib/problems/views";
import { PayloadView } from "@/content/_shared/views/submitted";
import { VerdictDetail } from "@/content/_shared/views/tests-table";

const inlineJudged: ProblemViews = { PayloadView };

const backendJudged: ProblemViews = { PayloadView, VerdictDetail };

export const problemViews: Record<string, ProblemViews> = {
  "answer-only": inlineJudged,
  "game-of-life": inlineJudged,
  "life-oscillator": inlineJudged,
  "roulette-daily": inlineJudged,

  "dominator-tree": backendJudged,
  "hanoi-kth": backendJudged,
  "interactive-binary-search": backendJudged,
  "leaky-bucket": backendJudged,
  "maze-runner": backendJudged,
  "perf-optimize": backendJudged,
};

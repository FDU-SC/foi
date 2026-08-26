import type { ProblemViews } from "@/lib/problems/views";
import { PayloadView } from "./_shared/views/submitted";
import { VerdictDetail } from "./_shared/views/tests-table";

/**
 * Which of the shared renderings each problem takes.
 *
 * The alternative, and what this used to be, is one `views.tsx` per problem
 * doing nothing but re-exporting from `_shared/views/`. Ten of them, in two
 * variants, none of them a custom component — the mapping below was already
 * the whole content of those files, spread across ten places that had to be
 * kept in step by hand.
 *
 * A problem that wants something else still writes its own
 * `content/problems/<slug>/views.tsx` and that file wins outright, slot for
 * slot; it does not merge with whatever it was listed as here. That is the
 * escape hatch, and it is the reason this table is a default rather than the
 * registry: the exception writes one file in its own directory and nothing
 * here has to be told about it.
 *
 * A problem left off the table and shipping no `views.tsx` renders both fields
 * as pretty-printed JSON. That is not a gap to be filled in later — see the
 * note on `viewsFor` — and `warmup-2025` is off the table on purpose: it is
 * retired, nobody maintains its rendering, and its historical submissions
 * showing as the objects they are is the honest answer.
 */

/**
 * Judged inline. The judge reports a status and a score and puts nothing in
 * `detail`, so there is nothing a `VerdictDetail` would draw better than the
 * kernel's dump.
 */
const inlineJudged: ProblemViews = { PayloadView };

/** Judged by a backend, all of which report `detail` as `{ tests, message }`. */
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

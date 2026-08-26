import type { ProblemUi } from "../../components/ui-config";
import type { ProblemConfigInput } from "@/lib/problems/types";

/**
 * The other half of the judging fork, plus the interactive relay.
 *
 * Both on one problem on purpose. They are independent mechanisms — a backend
 * may judge without ever being dialled, and `actions` is the one thing the
 * kernel still initiates outward — but each needs a live consumer for its
 * tests to mean anything, and a skeleton with two problems where one would do
 * is a skeleton somebody will trim.
 *
 * `config` is forwarded to the runner verbatim and the kernel never reads it.
 * What is here is the least `content/mock-runner.ts` needs to recognise the
 * job; a real problem puts testdata locations and limits in the same place.
 */
export const problem = {
  slug: "queued-echo",
  title: "排队回声",
  maxScore: 100,
  backend: {
    id: "example",
    config: { timeLimit: 1000, memoryLimit: 256 },
    actions: {
      // A rate limit on one action and not the other, because that is the
      // distinction `actionRateLimitSchema` exists for: the expensive verb and
      // the cheap one that follows it must not share a budget.
      start: { rateLimit: { max: 3, windowSeconds: 60 } },
      poll: {},
    },
  },
  ui: { submit: "code", languages: ["cpp", "python"] } satisfies ProblemUi,
  order: 2,
} satisfies ProblemConfigInput;

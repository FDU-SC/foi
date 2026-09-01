import type { InlineJudge, ProblemConfigInput } from "@/lib/problems/types";
import { FIXTURE_BACKEND } from "./backends";
import { AUDIENCE } from "./groups";

const accept: InlineJudge = ({ payload }) => {
  const correct = payload === "correct";
  return {
    result: { accepted: correct, score: correct ? 100 : 0 },
    detail: { received: payload },
  };
};

/**
 * Judged off-platform, and the only problem the fixture contest lists. Its own
 * submit throttle differs from both the platform default and the contest
 * entry's, so a test that confuses the three fails instead of passing by
 * coincidence.
 *
 * Undated on purpose: it leads the catalogue, so anything sorting by `addedAt`
 * has to move it to the back.
 */
export const external = {
  slug: "fixture-external",
  title: "外部评测的题",
  backend: {
    id: FIXTURE_BACKEND,
    config: { timeLimit: 1000 },
    actions: {
      spawn: { rateLimit: { max: 3, windowSeconds: 60 } },
      poll: {},
    },
  },
  submit: { rateLimit: { max: 5, windowSeconds: 60 } },
  order: 1,
} satisfies ProblemConfigInput;

/** Judged in-process, listed by no contest: the "public problem outside" shape. */
export const inline = {
  slug: "fixture-inline",
  title: "内联评测的题",
  backend: { kind: "inline" as const, judge: accept },
  order: 2,
  addedAt: "2026-01-10T09:00:00+08:00",
} satisfies ProblemConfigInput;

/**
 * Restricted to one group, so audience checks have something to refuse. Also
 * the newest of the dated ones while sitting last in `order`, which is what
 * makes reverse chronology distinguishable from the catalogue.
 */
export const gated = {
  slug: "fixture-gated",
  title: "限定受众的题",
  backend: { kind: "inline" as const, judge: accept },
  visibleTo: [AUDIENCE],
  order: 3,
  addedAt: "2026-05-20T09:00:00+08:00",
} satisfies ProblemConfigInput;

/**
 * Readable, unsubmittable: the axis where visibility and retirement diverge.
 * Externally judged with a declared action, so retirement is also tested
 * against the invoke gate and not only against submit.
 */
export const retired = {
  slug: "fixture-retired",
  title: "已下架的题",
  backend: {
    id: FIXTURE_BACKEND,
    actions: { poll: {} },
  },
  retired: true,
  order: 4,
} satisfies ProblemConfigInput;

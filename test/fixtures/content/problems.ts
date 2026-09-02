import type { InlineJudge, ProblemConfigInput } from "@/lib/problems/types";
import { FIXTURE_BACKEND } from "./backends";

const accept: InlineJudge = ({ payload }) => {
  const correct = payload === "correct";
  return {
    result: { accepted: correct, score: correct ? 100 : 0 },
    detail: { received: payload },
  };
};

/**
 * Judged off-platform, and the problem the fixture contest lists. Its own
 * submit throttle differs from both the platform default and the contest
 * entry's, so a test that confuses the three fails instead of passing by
 * coincidence.
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
} satisfies ProblemConfigInput;

/** Judged in-process, and carried by the round that never closes. */
export const inline = {
  slug: "fixture-inline",
  title: "内联评测的题",
  backend: { kind: "inline" as const, judge: accept },
} satisfies ProblemConfigInput;

/**
 * Carried only by rounds nobody can reach yet — one that has not started and
 * one no audience covers. Nothing else lists it, so it is the shape behind
 * "a problem is invisible until the contest holding it opens".
 */
export const gated = {
  slug: "fixture-gated",
  title: "尚未开放的题",
  backend: { kind: "inline" as const, judge: accept },
} satisfies ProblemConfigInput;

/**
 * Carried only by finished rounds, one per way of finishing: readable and
 * closed, readable and still collecting, sealed altogether. Externally judged
 * with a declared action, so the afterlife is tested against the invoke gate
 * and not only against submit.
 */
export const late = {
  slug: "fixture-late",
  title: "赛后的题",
  backend: {
    id: FIXTURE_BACKEND,
    actions: { poll: {} },
  },
} satisfies ProblemConfigInput;

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBMIT_RATE_LIMIT,
  problemConfigSchema,
  submitRateLimit,
  type ActionRateLimit,
} from "./types";

/**
 * Which of the three layers wins.
 *
 * Parsed through the schema rather than hand-built, because the default that
 * fills in `submit` when a problem omits it is part of what is being tested:
 * a problem that says nothing about submitting at all must still resolve.
 */
function problemWith(submit?: Record<string, unknown>) {
  return problemConfigSchema.parse({
    slug: "example",
    title: "Example",
    backend: { id: "queue-a" },
    ...(submit ? { submit } : {}),
  });
}

const CONTEST: ActionRateLimit = { max: 3, windowSeconds: 30 };
const PROBLEM: ActionRateLimit = { max: 7, windowSeconds: 90 };

describe("submitRateLimit", () => {
  it("题目和比赛都没说时用内核默认", () => {
    expect(submitRateLimit(problemWith())).toEqual(DEFAULT_SUBMIT_RATE_LIMIT);
  });

  it("题目自己声明了就用题目的", () => {
    expect(submitRateLimit(problemWith({ rateLimit: PROBLEM }))).toEqual(
      PROBLEM,
    );
  });

  it("比赛在引用处覆盖了就用比赛的", () => {
    expect(
      submitRateLimit(problemWith({ rateLimit: PROBLEM }), CONTEST),
    ).toEqual(CONTEST);
  });

  it("比赛可以覆盖一道没有自己声明限流的题目", () => {
    expect(submitRateLimit(problemWith(), CONTEST)).toEqual(CONTEST);
  });

  it("比赛没覆盖时不掩盖题目自己的声明", () => {
    // `undefined` is what the route passes for a submission made outside any
    // contest, and for a contest entry that left `rateLimit` off. Neither may
    // fall through to the kernel default while the problem has an opinion.
    expect(submitRateLimit(problemWith({ rateLimit: PROBLEM }), undefined)).toEqual(
      PROBLEM,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBMIT_RATE_LIMIT,
  problemConfigSchema,
  submitRateLimit,
  type ActionRateLimit,
} from "./types";

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

    expect(submitRateLimit(problemWith({ rateLimit: PROBLEM }), undefined)).toEqual(
      PROBLEM,
    );
  });
});

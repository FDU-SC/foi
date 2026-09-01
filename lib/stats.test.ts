import { describe, expect, it } from "vitest";
import { computeProblemStatuses, isAcceptedResult } from "./stats";

describe("isAcceptedResult", () => {
  it("accepted 为 true 时判定通过", () => {
    expect(isAcceptedResult({ accepted: true })).toBe(true);
  });

  it("accepted 缺失或非布尔时不算通过", () => {
    expect(isAcceptedResult({ accepted: "true" })).toBe(false);
    expect(isAcceptedResult({ status: "accepted" })).toBe(false);
    expect(isAcceptedResult(null)).toBe(false);
    expect(isAcceptedResult("x")).toBe(false);
  });
});

describe("computeProblemStatuses", () => {
  const sub = (
    slug: string,
    status: string | null,
    accepted: boolean,
    at: string,
  ) => ({
    problemSlug: slug,
    result: accepted ? { status, accepted: true } : { status },
    createdAt: at,
  });

  it("没有提交时返回空", () => {
    expect(computeProblemStatuses([]).size).toBe(0);
  });

  it("有 AC 的题显示 accepted", () => {
    const out = computeProblemStatuses([
      sub("a", "wrong_answer", false, "2026-01-01T00:00:00Z"),
      sub("a", "accepted", true, "2026-01-02T00:00:00Z"),
    ]);
    expect(out.get("a")).toEqual({ status: "accepted", accepted: true });
  });

  it("AC 优先于更新但失败的提交", () => {
    const out = computeProblemStatuses([
      sub("a", "accepted", true, "2026-01-01T00:00:00Z"),
      sub("a", "wrong_answer", false, "2026-01-03T00:00:00Z"),
    ]);
    expect(out.get("a")).toEqual({ status: "accepted", accepted: true });
  });

  it("没有 AC 时显示最近一次提交的状态", () => {
    const out = computeProblemStatuses([
      sub("a", "compile_error", false, "2026-01-01T00:00:00Z"),
      sub("a", "wrong_answer", false, "2026-01-02T00:00:00Z"),
    ]);
    expect(out.get("a")).toEqual({
      status: "wrong_answer",
      accepted: false,
    });
  });

  it("result 为空时 status 为 null", () => {
    const out = computeProblemStatuses([
      { problemSlug: "a", result: null, createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(out.get("a")).toEqual({ status: null, accepted: false });
  });

  it("多题互不干扰", () => {
    const out = computeProblemStatuses([
      sub("a", "accepted", true, "2026-01-01T00:00:00Z"),
      sub("b", "time_limit_exceeded", false, "2026-01-01T00:00:00Z"),
    ]);
    expect(out.get("a")?.accepted).toBe(true);
    expect(out.get("b")?.status).toBe("time_limit_exceeded");
  });
});

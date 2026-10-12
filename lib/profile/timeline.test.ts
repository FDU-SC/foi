import { describe, expect, it } from "vitest";
import { dayStart } from "@/lib/calendar-day";
import { isCatalogue } from "@/lib/contests/catalogue";
import { contestProblemRefs } from "@/lib/contests/refs";
import type { PairActivity } from "./activity";
import { activityWindow, activityYears, submissionsIn, timelineOf } from "./timeline";

const now = dayStart("2026-09-26");

const catalogued = contestProblemRefs().find((ref) => isCatalogue(ref.contest.slug))!;
const round = contestProblemRefs().find((ref) => !isCatalogue(ref.contest.slug))!;

function pair(ref: typeof round, submittedOn: string[], solvedOn?: string): PairActivity {
  return {
    ref,
    progress: { state: solvedOn ? "solved" : "attempted", verdict: null },
    solvedAt: solvedOn ? dayStart(solvedOn) : null,
    lastAt: dayStart(submittedOn.at(-1)!),
    submittedOn,
  };
}

describe("activityWindow", () => {
  it("默认是截至今天的 53 周，第一周从周日开始", () => {
    expect(activityWindow(now, null)).toEqual({ from: "2025-09-21", until: "2026-09-26", year: null });
  });

  it("指定年份时覆盖整年，但不超过今天", () => {
    expect(activityWindow(now, 2025)).toEqual({ from: "2025-01-01", until: "2025-12-31", year: 2025 });
    expect(activityWindow(now, 2026)).toEqual({ from: "2026-01-01", until: "2026-09-26", year: 2026 });
  });
});

describe("activityYears", () => {
  it("从加入或首次提交那年列到今年，新的在前", () => {
    const days = new Map([["2024-03-01", 1]]);
    expect(activityYears(days, dayStart("2025-06-01"), now)).toEqual([2026, 2025, 2024]);
    expect(activityYears(new Map(), dayStart("2026-01-02"), now)).toEqual([2026]);
  });
});

describe("submissionsIn", () => {
  it("只数窗口内的提交", () => {
    const days = new Map([["2024-12-31", 5], ["2025-01-01", 2], ["2025-12-31", 3]]);
    expect(submissionsIn(days, activityWindow(now, 2025))).toBe(5);
  });
});

describe("timelineOf", () => {
  const window = activityWindow(now, 2026);

  it("按月归并通过、提交与首次参赛，新的月份在前", () => {
    const months = timelineOf([
      pair(catalogued, ["2026-08-30", "2026-09-02", "2026-09-03"], "2026-09-03"),
      pair(round, ["2025-12-31", "2026-09-10"]),
    ], window);

    expect(months.map(({ month }) => month)).toEqual(["2026-09", "2026-08"]);
    const [september, august] = months;
    expect(september.submissions).toBe(3);
    expect(september.solved.map(({ ref }) => ref)).toEqual([catalogued]);
    expect(september.tried.map(({ pair, count }) => [pair.ref, count])).toEqual([[catalogued, 2], [round, 1]]);
    expect(august.tried.map(({ count }) => count)).toEqual([1]);
    expect(months.flatMap(({ entered }) => entered)).toEqual([]);
  });

  it("比赛记在首次提交的月份，题库分区不算参赛", () => {
    const months = timelineOf([
      pair(round, ["2026-03-05", "2026-04-01"]),
      pair(catalogued, ["2026-03-01"]),
    ], window);

    expect(months.find(({ month }) => month === "2026-03")?.entered).toEqual([round.contest]);
    expect(months.find(({ month }) => month === "2026-04")?.entered).toEqual([]);
  });
});

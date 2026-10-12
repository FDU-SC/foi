import { dayOf, shiftDay, weekdayOf } from "@/lib/calendar-day";
import { isCatalogue } from "@/lib/contests/catalogue";
import type { ContestConfig } from "@/lib/contests/types";
import type { PairActivity } from "./activity";

/** A stretch of days, both ends inclusive, as `YYYY-MM-DD`. */
export interface ActivityWindow {
  from: string;
  until: string;

  /** A calendar year, or null for the weeks up to today. */
  year: number | null;
}

/**
 * One calendar year, or 53 weeks ending today with the first week starting on
 * Sunday. Neither reaches past today.
 */
export function activityWindow(now: Date, year: number | null): ActivityWindow {
  const today = dayOf(now);
  if (year === null) {
    return { from: shiftDay(today, -(52 * 7 + weekdayOf(today))), until: today, year };
  }
  const end = `${year}-12-31`;
  return { from: `${year}-01-01`, until: end < today ? end : today, year };
}

/** Years with something to show, newest first: from joining or the first submission to now. */
export function activityYears(
  days: ReadonlyMap<string, number>,
  joinedAt: Date,
  now: Date,
): number[] {
  const current = Number(dayOf(now).slice(0, 4));
  const first = Math.min(
    Number(dayOf(joinedAt).slice(0, 4)),
    ...[...days.keys()].map((day) => Number(day.slice(0, 4))),
  );
  return Array.from({ length: current - first + 1 }, (_, index) => current - index);
}

export function submissionsIn(
  days: ReadonlyMap<string, number>,
  { from, until }: ActivityWindow,
): number {
  let total = 0;
  for (const [day, count] of days) {
    if (day >= from && day <= until) total += count;
  }
  return total;
}

export interface MonthActivity {
  /** `YYYY-MM`. */
  month: string;
  submissions: number;

  /** First solved this month, latest first. */
  solved: PairActivity[];

  /** Submitted to this month, most submissions first. */
  tried: { pair: PairActivity; count: number }[];

  /** Contests outside the catalogue first submitted to this month. */
  entered: ContestConfig[];
}

/** What happened in each month of the window that saw any submission, latest first. */
export function timelineOf(
  pairs: readonly PairActivity[],
  window: ActivityWindow,
): MonthActivity[] {
  const months = new Map<string, MonthActivity>();
  const monthOf = (month: string) => {
    let entry = months.get(month);
    if (!entry) {
      entry = { month, submissions: 0, solved: [], tried: [], entered: [] };
      months.set(month, entry);
    }
    return entry;
  };
  const within = (day: string) => day >= window.from && day <= window.until;

  const firstIn = new Map<string, { contest: ContestConfig; day: string }>();
  for (const pair of pairs) {
    const counts = new Map<string, number>();
    for (const day of pair.submittedOn) {
      if (!within(day)) continue;
      const month = day.slice(0, 7);
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    for (const [month, count] of counts) {
      const entry = monthOf(month);
      entry.submissions += count;
      entry.tried.push({ pair, count });
    }

    const solvedOn = pair.solvedAt && dayOf(pair.solvedAt);
    if (solvedOn && within(solvedOn)) monthOf(solvedOn.slice(0, 7)).solved.push(pair);

    const { contest } = pair.ref;
    const first = pair.submittedOn[0];
    const known = firstIn.get(contest.slug);
    if (!isCatalogue(contest.slug) && first && (!known || first < known.day)) {
      firstIn.set(contest.slug, { contest, day: first });
    }
  }
  for (const { contest, day } of firstIn.values()) {
    if (within(day)) monthOf(day.slice(0, 7)).entered.push(contest);
  }

  return [...months.values()]
    .map((entry) => ({
      ...entry,
      solved: entry.solved.toSorted((a, b) => b.solvedAt!.getTime() - a.solvedAt!.getTime()),
      tried: entry.tried.toSorted((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

import { TZDate } from "@date-fns/tz";
import { site } from "@/lib/site";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function fields(day: string): [number, number, number] | undefined {
  const match = DAY.exec(day);
  if (!match) return undefined;
  const [year, month, date] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, date));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === date
    ? [year, month, date]
    : undefined;
}

/** A `YYYY-MM-DD` naming a real calendar day, or undefined. */
export function readDay(value: string | undefined): string | undefined {
  return value !== undefined && fields(value) ? value : undefined;
}

/** A plain `Date`: `TZDate` serializes with an offset, which drizzle and callers do not expect. */
function startOf(year: number, month: number, date: number): Date {
  return new Date(+new TZDate(year, month - 1, date, site.timezone));
}

/** When a calendar day read by `readDay` begins in the site's timezone. */
export function dayStart(day: string): Date {
  const [year, month, date] = fields(day)!;
  return startOf(year, month, date);
}

/** When the following day begins: the exclusive end of a range ending on `day`. */
export function dayEnd(day: string): Date {
  const [year, month, date] = fields(day)!;
  return startOf(year, month, date + 1);
}

const pad = (value: number) => String(value).padStart(2, "0");

function utcOf(day: string): Date {
  const [year, month, date] = fields(day)!;
  return new Date(Date.UTC(year, month - 1, date));
}

/** The day `by` days after `day`; negative goes back. */
export function shiftDay(day: string, by: number): string {
  const at = utcOf(day);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(day: string): number {
  return utcOf(day).getUTCDay();
}

/** The `YYYY-MM-DD` an instant falls on in the site's timezone. */
export function dayOf(at: Date): string {
  const zoned = new TZDate(+at, site.timezone);
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`;
}

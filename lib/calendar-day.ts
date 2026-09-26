import { site } from "@/lib/site";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const zone = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

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

/** How far the site's wall clock runs ahead of UTC at this instant. */
function offsetAt(instant: number): number {
  const parts = Object.fromEntries(zone.formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

function startOf(year: number, month: number, date: number): Date {
  const wall = Date.UTC(year, month - 1, date);
  const guess = wall - offsetAt(wall);
  return new Date(wall - offsetAt(guess));
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

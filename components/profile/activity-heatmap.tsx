import { Fragment } from "react";
import { dayStart, shiftDay, weekdayOf } from "@/lib/calendar-day";
import { dateFormatter } from "@/lib/format";
import type { ActivityWindow } from "@/lib/profile/timeline";
import { cn } from "@/lib/utils";

const LEVELS = [
  "bg-border/50",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
];

const dayLabel = dateFormatter({ dateStyle: "medium" });
const monthLabel = dateFormatter({ month: "short" });
const weekdayLabel = dateFormatter({ weekday: "short" });

function levelOf(count: number, max: number): number {
  if (count === 0) return 0;
  return Math.max(1, Math.ceil((count / max) * (LEVELS.length - 1)));
}

function longestStreak(days: readonly string[], counts: ReadonlyMap<string, number>): number {
  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = counts.has(day) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Submissions per day across a window, one column per week starting on Sunday. */
export function ActivityHeatmap({
  days,
  window,
}: {
  days: ReadonlyMap<string, number>;
  window: ActivityWindow;
}) {
  const weeks: string[][] = [];
  for (let start = shiftDay(window.from, -weekdayOf(window.from)); start <= window.until; start = shiftDay(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftDay(start, index)));
  }
  const inside = (day: string) => day >= window.from && day <= window.until;
  const shown = weeks.flat().filter(inside);
  const active = shown.filter((day) => days.has(day)).length;
  const max = Math.max(1, ...shown.map((day) => days.get(day) ?? 0));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={`活跃 ${active} 天`}
          className="grid min-w-[36rem] gap-[3px] text-[10px] leading-none"
          style={{ gridTemplateColumns: `1.75rem repeat(${weeks.length}, minmax(0, 1.125rem))` }}
        >
          <span />
          {weeks.map((week) => {
            const opening = week.find((day) => day.endsWith("-01") && inside(day));
            return (
              <span key={week[0]} className="text-fg-subtle h-3.5 whitespace-nowrap">
                {opening ? monthLabel.format(dayStart(opening)) : null}
              </span>
            );
          })}
          {weeks[0].map((_, weekday) => (
            <Fragment key={weekday}>
              <span className="text-fg-subtle self-center">
                {weekday % 2 === 1 ? weekdayLabel.format(dayStart(weeks[0][weekday])) : null}
              </span>
              {weeks.map((week) => {
                const day = week[weekday];
                if (!inside(day)) return <span key={day} />;
                const count = days.get(day) ?? 0;
                return (
                  <span
                    key={day}
                    title={`${dayLabel.format(dayStart(day))} · ${count} 次提交`}
                    className={cn("aspect-square w-full rounded-[2px]", LEVELS[levelOf(count, max)])}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="text-fg-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          活跃 <strong className="text-fg-muted font-mono">{active}</strong> 天 · 最长连续{" "}
          <strong className="text-fg-muted font-mono">{longestStreak(shown, days)}</strong> 天
        </span>
        <span aria-hidden className="flex items-center gap-[3px] text-[10px]">
          <span className="mr-1">少</span>
          {LEVELS.map((level) => (
            <span key={level} className={cn("size-2.5 rounded-[2px]", level)} />
          ))}
          <span className="ml-1">多</span>
        </span>
      </div>
    </div>
  );
}

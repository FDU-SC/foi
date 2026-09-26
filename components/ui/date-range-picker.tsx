"use client";

import { TZDate } from "@date-fns/tz";
import Link from "next/link";
import { useRef, useState } from "react";
import { DayPicker, type ClassNames, type DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { useDismiss } from "@/components/ui/use-dismiss";
import { cn } from "@/lib/utils";

/** Each end a `YYYY-MM-DD`, either one optional. */
export interface DayRange {
  from?: string;
  to?: string;
}

/** The earliest year the year dropdown offers. */
const START_YEAR = 2020;

const pad = (value: number) => String(value).padStart(2, "0");
const show = (day: string) => day.replaceAll("-", "/");

function toDay(date: Date, timeZone: string): string {
  const day = new TZDate(date, timeZone);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function toDate(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new TZDate(year, month - 1, date, timeZone);
}

function toRange({ from, to }: DayRange, timeZone: string): DateRange | undefined {
  return from || to
    ? { from: from ? toDate(from, timeZone) : undefined, to: to ? toDate(to, timeZone) : undefined }
    : undefined;
}

function fromRange(range: DateRange | undefined, timeZone: string): DayRange {
  return { from: range?.from && toDay(range.from, timeZone), to: range?.to && toDay(range.to, timeZone) };
}

function presets(today: Date, timeZone: string): { label: string; range: DateRange }[] {
  const now = new TZDate(today, timeZone);
  const [year, month, date] = [now.getFullYear(), now.getMonth(), now.getDate()];
  const at = (y: number, m: number, d: number) => new TZDate(y, m, d, timeZone);
  return [
    { label: "最近 7 天", range: { from: at(year, month, date - 6), to: today } },
    { label: "最近 30 天", range: { from: at(year, month, date - 29), to: today } },
    { label: "本月", range: { from: at(year, month, 1), to: today } },
    { label: "上个月", range: { from: at(year, month - 1, 1), to: at(year, month, 0) } },
    { label: "今年", range: { from: at(year, 0, 1), to: today } },
  ];
}

export function rangeLabel({ from, to }: DayRange): string | undefined {
  if (from && to) return from === to ? show(from) : `${show(from)} – ${show(to)}`;
  if (from) return `${show(from)} 起`;
  if (to) return `至 ${show(to)}`;
  return undefined;
}

const CALENDAR: Partial<ClassNames> = {
  months: "relative",
  month: "space-y-2",
  month_caption: "flex h-8 items-center justify-center",
  dropdowns: "flex items-center gap-1",
  dropdown_root: "relative inline-flex items-center rounded-md hover:bg-surface-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
  dropdown: "absolute inset-0 z-10 w-full cursor-pointer appearance-none opacity-0",
  caption_label: "text-fg inline-flex items-center gap-1 px-2 py-1 text-sm font-medium tabular-nums [&>svg]:size-3.5 [&>svg]:fill-current",
  nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
  button_previous: "text-fg-muted hover:bg-surface-2 hover:text-fg inline-flex size-8 items-center justify-center rounded-md disabled:opacity-40",
  button_next: "text-fg-muted hover:bg-surface-2 hover:text-fg inline-flex size-8 items-center justify-center rounded-md disabled:opacity-40",
  chevron: "size-4 fill-current",
  month_grid: "w-full border-collapse",
  weekday: "text-fg-subtle h-8 w-9 text-xs font-normal",
  day: "p-0 text-center",
  day_button: "text-fg hover:bg-surface-2 size-9 rounded-md text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-primary",
  outside: "[&>button]:text-fg-subtle",
  today: "[&>button]:ring-primary/50 [&>button]:ring-1 [&>button]:ring-inset",
  range_middle: "bg-primary-subtle [&>button]:text-primary [&>button]:rounded-none [&>button]:hover:bg-primary-subtle",
  range_start: "[&>button]:bg-primary [&>button]:text-primary-fg [&>button]:font-medium [&>button]:hover:bg-primary",
  range_end: "[&>button]:bg-primary [&>button]:text-primary-fg [&>button]:font-medium [&>button]:hover:bg-primary",
  hidden: "invisible",
};

/**
 * One field for a range of days, picked on one calendar whose month and year
 * captions open lists to jump by. Applying submits a GET form that carries the
 * page's other parameters.
 */
export function DateRangePicker({
  action,
  carried,
  names,
  value,
  label,
  timeZone,
}: {
  action: string;
  /** The page's other parameters, resent with the range. */
  carried: { name: string; value: string }[];
  names: { from: string; to: string };
  value: DayRange;
  label: string;
  /** The zone the server reads each day in; "today" and the calendar follow it. */
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => toRange(value, timeZone));
  const [month, setMonth] = useState<Date | undefined>();
  const [today, setToday] = useState<Date | undefined>();
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));

  const toggle = () => {
    if (!open) {
      const now = TZDate.tz(timeZone);
      const range = toRange(value, timeZone);
      setToday(now);
      setDraft(range);
      setMonth(range?.to ?? range?.from ?? now);
    }
    setOpen(!open);
  };

  const choose = (range: DateRange) => {
    setDraft(range);
    setMonth(range.to);
  };

  const current = rangeLabel(value);
  const picked = fromRange(draft, timeZone);
  const clearHref = action + (carried.length ? `?${new URLSearchParams(carried.map(({ name, value: one }) => [name, one]))}` : "");

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}：${current ?? "未选择"}`}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
          current
            ? "border-primary/40 bg-primary-subtle text-primary"
            : "border-border text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg",
        )}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4 shrink-0">
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="tabular-nums">{current ?? "选择日期范围"}</span>
      </button>

      {open && today ? (
        <div
          role="dialog"
          aria-label={label}
          className="border-border bg-surface absolute top-full left-0 z-30 mt-1.5 max-w-[calc(100vw-2rem)] rounded-lg border shadow-lg"
        >
          <div className="flex flex-col sm:flex-row">
            <ul aria-label="快捷范围" className="border-border/70 flex flex-wrap gap-1 border-b p-2 sm:w-28 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
              {presets(today, timeZone).map(({ label: name, range }) => {
                const { from, to } = fromRange(range, timeZone);
                const active = from === picked.from && to === picked.to;
                return (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => choose(range)}
                      className={cn(
                        "w-full rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors",
                        active ? "bg-primary-subtle text-primary font-medium" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {name}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="p-3">
              <DayPicker
                mode="range"
                locale={zhCN}
                weekStartsOn={1}
                captionLayout="dropdown"
                timeZone={timeZone}
                startMonth={new TZDate(START_YEAR, 0, 1, timeZone)}
                showOutsideDays
                fixedWeeks
                resetOnSelect
                selected={draft}
                onSelect={setDraft}
                month={month}
                onMonthChange={setMonth}
                classNames={CALENDAR}
              />
            </div>
          </div>

          <form action={action} className="border-border/70 flex items-center gap-2 border-t p-3">
            {carried.map((field, index) => (
              <input key={index} type="hidden" name={field.name} value={field.value} />
            ))}
            {picked.from ? <input type="hidden" name={names.from} value={picked.from} /> : null}
            {picked.to ? <input type="hidden" name={names.to} value={picked.to} /> : null}
            <span className="text-fg-muted min-w-0 flex-1 truncate text-xs tabular-nums">
              {rangeLabel(picked) ?? "未选择"}
            </span>
            {current ? (
              <Link href={clearHref} className="text-fg-muted text-xs underline underline-offset-2">
                清除
              </Link>
            ) : null}
            <Button type="submit" size="sm" variant="primary">应用</Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

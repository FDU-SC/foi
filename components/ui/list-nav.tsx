import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ListNavEntry {
  key: string;
  title: string;
  href: string;
  current: boolean;
  flags?: { label: string; tone: BadgeTone }[];

  /** Drawn as a count and a bar; `solved` is absent without complete progress. */
  progress?: { solved: number | null; total: number };
}

export interface ListNavGroup {
  heading: string | null;

  /** Everything under the heading as one entry, when the heading gathers several. */
  all?: ListNavEntry;
  lists: ListNavEntry[];
}

/**
 * Entries under direction headings. Headings only label; every link is an
 * entry beneath one. A column on wide screens, one scrolling row of chips on
 * narrow ones, where the headings are not shown.
 */
export function ListNav({
  label,
  all,
  groups,
}: {
  label: string;
  all: ListNavEntry;
  groups: ListNavGroup[];
}) {
  return (
    <nav aria-label={label} className="min-w-0 lg:sticky lg:top-20">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0">
        <li className="shrink-0">
          <ListLink entry={all} />
        </li>
        {groups.map((group) => (
          <li key={group.heading ?? "ungrouped"} className="contents lg:block">
            <p className="text-fg mb-1 hidden px-2 py-1 text-sm font-semibold lg:block">
              {group.heading ?? "其他"}
            </p>
            <ul className="contents lg:block lg:space-y-0.5 lg:pl-3">
              {group.all ? (
                <li className="lg:border-border/70 shrink-0 lg:mb-1 lg:border-b lg:pb-1">
                  <ListLink
                    entry={group.all}
                    emphasis
                    label={<>
                      <span className="lg:hidden">{group.all.title}</span>
                      <span className="hidden lg:inline">全部</span>
                    </>}
                  />
                </li>
              ) : null}
              {group.lists.map((entry) => (
                <li key={entry.key} className="shrink-0">
                  <ListLink entry={entry} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A chip on narrow screens, a row on wide ones. `emphasis` marks a direction's
 * summary entry apart from the sections beneath it.
 */
function ListLink({
  entry,
  label = entry.title,
  emphasis = false,
}: {
  entry: ListNavEntry;
  label?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={entry.href}
      aria-current={entry.current ? "page" : undefined}
      className={cn(
        "block rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
        "lg:rounded-md lg:border-transparent lg:px-2 lg:whitespace-normal",
        entry.current
          ? "border-primary/40 bg-primary-subtle text-primary font-medium"
          : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("min-w-0 lg:flex-1", emphasis && "lg:font-semibold", emphasis && !entry.current && "lg:text-fg")}>
          {label}
        </span>
        {entry.flags?.map((flag) => (
          <Badge key={flag.label} tone={flag.tone}>
            {flag.label}
          </Badge>
        ))}
        {entry.progress ? (
          <span className="font-mono text-xs tabular-nums opacity-70">
            {entry.progress.solved !== null ? `${entry.progress.solved} / ${entry.progress.total}` : entry.progress.total}
          </span>
        ) : null}
      </div>
      {entry.progress ? (
        <div className="mt-1.5 hidden lg:block">
          <Progress {...entry.progress} label={entry.title} />
        </div>
      ) : null}
    </Link>
  );
}

/** Solved out of total as a bar; absent without complete progress or without problems. */
function Progress({ solved, total, label }: { solved: number | null; total: number; label: string }) {
  if (solved === null || total === 0) return null;

  return (
    <div
      role="progressbar"
      aria-label={`${label}完成进度`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={solved}
      aria-valuetext={`${solved} / ${total}`}
      className="bg-surface-3 h-1.5 overflow-hidden rounded-full"
    >
      <div className="bg-primary h-full rounded-full" style={{ width: `${(solved / total) * 100}%` }} />
    </div>
  );
}

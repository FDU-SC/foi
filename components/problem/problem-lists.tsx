import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ProblemListEntry {
  /** Absent on the entry that stands for every list at once. */
  slug?: string;
  title: string;
  href: string;
  total: number;

  /** Present only when every problem in the list reports progress. */
  solved: number | null;
  flags?: { label: string; tone: BadgeTone }[];
}

export interface ProblemListGroup {
  heading: string | null;
  lists: ProblemListEntry[];
}

/**
 * The catalogue's lists, grouped under their headings. A column on wide
 * screens, one scrolling row of chips on narrow ones.
 */
export function ProblemLists({
  all,
  groups,
  selected,
}: {
  all: ProblemListEntry;
  groups: ProblemListGroup[];
  selected?: string;
}) {
  return (
    <nav aria-label="题单" className="min-w-0 lg:sticky lg:top-20">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0">
        <li className="shrink-0">
          <ListLink entry={all} current={selected === undefined} />
        </li>
        {groups.map((group) => (
          <li key={group.heading ?? "ungrouped"} className="contents lg:block">
            <div className="mb-1 hidden space-y-1.5 px-2 lg:block">
              <p className="text-fg-subtle text-xs font-medium">{group.heading ?? "其他"}</p>
              {group.lists.length > 1 ? (
                <Progress {...sum(group.lists)} label={group.heading ?? "其他"} summary />
              ) : null}
            </div>
            <ul className="contents lg:block lg:space-y-0.5">
              {group.lists.map((entry) => (
                <li key={entry.slug} className="shrink-0">
                  <ListLink entry={entry} current={entry.slug === selected} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A group's progress is known only when every list in it reports its own. */
function sum(lists: ProblemListEntry[]): { solved: number | null; total: number } {
  const total = lists.reduce((count, entry) => count + entry.total, 0);
  const solved = lists.some((entry) => entry.solved === null)
    ? null
    : lists.reduce((count, entry) => count + (entry.solved ?? 0), 0);
  return { solved, total };
}

function ListLink({ entry, current }: { entry: ProblemListEntry; current: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "block rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
        "lg:rounded-md lg:border-transparent lg:px-2 lg:whitespace-normal",
        current
          ? "border-primary/40 bg-primary-subtle text-primary font-medium"
          : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 lg:flex-1">{entry.title}</span>
        {entry.flags?.map((flag) => (
          <Badge key={flag.label} tone={flag.tone}>
            {flag.label}
          </Badge>
        ))}
        <span className="font-mono text-xs tabular-nums opacity-70">
          {entry.solved !== null ? `${entry.solved} / ${entry.total}` : entry.total}
        </span>
      </div>
      <div className="mt-1.5 hidden lg:block">
        <Progress solved={entry.solved} total={entry.total} label={entry.title} />
      </div>
    </Link>
  );
}

/** Solved out of total as a bar; absent without complete progress or without problems. */
function Progress({
  solved,
  total,
  label,
  summary = false,
}: {
  solved: number | null;
  total: number;
  label: string;
  summary?: boolean;
}) {
  if (solved === null || total === 0) return null;
  const share = solved / total;

  return (
    <div className="space-y-1.5">
      {summary ? (
        <div className="text-fg-muted flex items-center justify-between gap-3 text-xs tabular-nums">
          <span>{solved} / {total}</span>
          <span className="font-mono">{Math.round(share * 100)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={`${label}完成进度`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={solved}
        aria-valuetext={`${solved} / ${total}`}
        className="bg-surface-3 h-1.5 overflow-hidden rounded-full"
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

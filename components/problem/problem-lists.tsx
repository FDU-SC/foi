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
            <p className="text-fg-subtle mb-1 hidden px-2 text-xs font-medium lg:block">
              {group.heading ?? "其他"}
            </p>
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

function ListLink({ entry, current }: { entry: ProblemListEntry; current: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
        "lg:rounded-md lg:border-transparent lg:px-2 lg:whitespace-normal",
        current
          ? "border-primary/40 bg-primary-subtle text-primary font-medium"
          : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      <span className="min-w-0 lg:flex-1">{entry.title}</span>
      {entry.flags?.map((flag) => (
        <Badge key={flag.label} tone={flag.tone}>
          {flag.label}
        </Badge>
      ))}
      <span className="font-mono text-xs tabular-nums opacity-70">
        {entry.solved !== null ? `${entry.solved}/${entry.total}` : entry.total}
      </span>
    </Link>
  );
}

import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ListNavEntry {
  key: string;
  title: string;
  href: string;
  current: boolean;
  flags?: { label: string; tone: BadgeTone }[];

  /** Drawn as a count; `solved` is absent without complete progress. */
  progress?: { solved: number | null; total: number };
}

export interface ListNavGroup {
  heading: string | null;

  /** Everything under the heading as one entry, when the heading gathers several. */
  all?: ListNavEntry;
  lists: ListNavEntry[];
}

/**
 * Entries under direction headings, as a table of contents. A heading that
 * gathers several lists is itself the entry for all of them; otherwise it only
 * labels. A column on wide screens, one scrolling row on narrow ones, where
 * only headings that are entries show.
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
      <ul className="flex gap-4 overflow-x-auto lg:flex-col lg:gap-5 lg:overflow-visible">
        <li className="shrink-0">
          <ListLink entry={all} heading />
        </li>
        {groups.map((group) => (
          <li key={group.heading ?? "ungrouped"} className="contents lg:block">
            {group.all ? (
              <div className="shrink-0">
                <ListLink entry={group.all} heading />
              </div>
            ) : (
              <p className="text-fg hidden py-1 pl-3.5 text-sm font-semibold lg:block">
                {group.heading ?? "其他"}
              </p>
            )}
            <ul className="contents lg:block">
              {group.lists.map((entry) => (
                <li key={entry.key} className="shrink-0">
                  <ListLink entry={entry} indent />
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
 * Underlined when current on narrow screens, marked by a left rule on wide
 * ones. A list without problems is greyed.
 */
function ListLink({
  entry,
  heading = false,
  indent = false,
}: {
  entry: ListNavEntry;
  heading?: boolean;
  indent?: boolean;
}) {
  const empty = entry.progress?.total === 0;
  return (
    <Link
      href={entry.href}
      aria-current={entry.current ? "page" : undefined}
      className={cn(
        "flex items-baseline gap-2 border-b-2 py-1 text-sm whitespace-nowrap transition-colors",
        "lg:border-b-0 lg:border-l-2 lg:pr-1 lg:whitespace-normal",
        indent ? "lg:pl-6" : "lg:pl-3",
        entry.current
          ? "border-fg text-fg font-semibold"
          : cn(
              "hover:text-fg border-transparent",
              heading ? "text-fg font-semibold" : empty ? "text-fg-subtle" : "text-fg-muted",
            ),
      )}
    >
      <span className="min-w-0 lg:flex-1">{entry.title}</span>
      {entry.flags?.map((flag) => (
        <Badge key={flag.label} tone={flag.tone}>
          {flag.label}
        </Badge>
      ))}
      {entry.progress ? <Count {...entry.progress} label={entry.title} /> : null}
    </Link>
  );
}

/**
 * Solved out of total. With complete progress and at least one problem the
 * count is announced as a progress bar; otherwise it is only the total.
 */
function Count({ solved, total, label }: { solved: number | null; total: number; label: string }) {
  const text = solved !== null ? `${solved}/${total}` : String(total);
  const style = "font-mono text-xs font-normal tabular-nums";

  if (solved === null || total === 0) {
    return <span className={cn(style, "text-fg-subtle")}>{text}</span>;
  }

  return (
    <span
      role="progressbar"
      aria-label={`${label}完成进度`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={solved}
      aria-valuetext={`${solved} / ${total}`}
      className={cn(style, solved > 0 ? "text-fg" : "text-fg-muted")}
    >
      {text}
    </span>
  );
}

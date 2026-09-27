import Link from "next/link";
import { cn } from "@/lib/utils";

export interface TabLink {
  key: string;
  label: string;
  href: string;
  current: boolean;

  /** Shown beside the label as a counter. */
  count?: number;
}

/**
 * Tabs that are links: each tab is its own address, so switching is plain
 * navigation. The strip sinks one pixel into the wrapper's rule, so the current
 * tab's underline covers it.
 */
export function Tabs({
  label,
  tabs,
  className,
}: {
  label: string;
  tabs: TabLink[];
  className?: string;
}) {
  return (
    <div className={cn("border-border border-b", className)}>
      <nav aria-label={label} className="-mb-px flex gap-5 overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.current ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 py-2 text-sm whitespace-nowrap transition-colors",
              tab.current
                ? "border-fg text-fg font-medium"
                : "text-fg-muted hover:text-fg border-transparent",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="text-fg-subtle text-xs font-normal tabular-nums">{tab.count}</span>
            ) : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

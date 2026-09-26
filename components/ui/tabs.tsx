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

/** Tabs that are links: each tab is its own address, so switching is plain navigation. */
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
    <nav aria-label={label} className={cn("border-border flex gap-1 border-b", className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab.current
              ? "border-primary text-primary"
              : "text-fg-muted hover:text-fg hover:border-border-strong border-transparent",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="bg-surface-2 text-fg-muted rounded-full px-1.5 font-mono text-xs leading-5 tabular-nums">
              {tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

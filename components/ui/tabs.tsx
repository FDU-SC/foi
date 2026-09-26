import Link from "next/link";
import { cn } from "@/lib/utils";

export interface TabLink {
  key: string;
  label: string;
  href: string;
  current: boolean;
}

/** Tabs that are links: each tab is its own address, so switching is plain navigation. */
export function Tabs({ label, tabs }: { label: string; tabs: TabLink[] }) {
  return (
    <nav aria-label={label} className="border-border flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab.current
              ? "border-primary text-primary"
              : "text-fg-muted hover:text-fg hover:border-border-strong border-transparent",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

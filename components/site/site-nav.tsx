"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationIndicator } from "@/components/ui/navigation-indicator";
import { cn } from "@/lib/utils";

export interface NavLink {
  href: string;
  label: string;
}

/**
 * Header navigation with a shared active-link indicator.
 * Entries are authorized on the server before reaching this client component.
 */
export function SiteNav({ items }: { items: NavLink[] }) {
  const pathname = usePathname();
  const id = useId();

  return (
    <nav className="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto pb-2 text-sm lg:order-none lg:w-auto lg:flex-1 lg:pb-0">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Narrow viewports scroll the strip rather than wrapping it,
              // keeping every navigation link reachable on small screens.
              "relative shrink-0 rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors",
              active
                ? "text-fg font-medium"
                : "text-fg-muted hover:text-fg hover:bg-surface-2/60",
            )}
          >
            {active ? (
              <NavigationIndicator
                name={`site-nav-active-${id}`}
                className="bg-surface-2 absolute inset-0 rounded-md"
              />
            ) : null}
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavLink {
  href: string;
  label: string;
  matches?: string[];
}

/**
 * Header navigation; the current entry is underlined against the header's
 * bottom rule. Entries are authorized on the server before reaching this
 * client component.
 */
export function SiteNav({ items }: { items: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="order-last -mb-px flex w-full min-w-0 gap-5 overflow-x-auto text-sm lg:order-none lg:w-auto lg:flex-1 lg:self-stretch">
      {items.map((item) => {
        const active = [item.href, ...(item.matches ?? [])].some(
          (path) => pathname === path || pathname.startsWith(`${path}/`),
        );

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Narrow viewports scroll the strip rather than wrapping it,
              // keeping every navigation link reachable on small screens.
              "flex shrink-0 items-center border-b-2 py-2.5 whitespace-nowrap transition-colors lg:py-0",
              active
                ? "border-fg text-fg font-medium"
                : "text-fg-muted hover:text-fg border-transparent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

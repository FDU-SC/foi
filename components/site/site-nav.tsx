"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LAYOUT_SPRING } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

export interface NavLink {
  href: string;
  label: string;
}

/**
 * The header navigation, with a highlight that slides to whichever entry the
 * reader is on.
 *
 * A shared `layoutId` is what makes it one pill moving rather than two pills
 * swapping: Motion pairs the element leaving one link with the one arriving at
 * the next and animates between their boxes.
 *
 * Which entries appear is decided on the server, before this list arrives —
 * gating belongs where `authorize` can be asked, not in the browser.
 */
export function SiteNav({ items }: { items: NavLink[] }) {
  const pathname = usePathname();

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
              <motion.span
                layoutId="site-nav-active"
                transition={LAYOUT_SPRING}
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

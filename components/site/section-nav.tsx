"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup } from "motion/react";
import { useId, ViewTransition } from "react";
import { NavigationIndicator } from "@/components/ui/navigation-indicator";
import { cn } from "@/lib/utils";

export function SectionNav({
  items,
  label,
}: {
  items: { href: string; label: string; matchNested?: boolean }[];
  label: string;
}) {
  const pathname = usePathname();
  const id = useId();
  const active =
    items.find((item) => pathname === item.href) ??
    items.find((item) => item.matchNested && pathname.startsWith(`${item.href}/`));
  return (
    <LayoutGroup id={id}>
      <ViewTransition default="none" update="page-stable">
        <nav
          aria-label={label}
          className="border-border flex min-w-0 gap-5 overflow-x-auto border-b text-sm"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active === item ? "page" : undefined}
              className={cn(
                "relative shrink-0 border-b-2 border-transparent px-1 py-2.5 font-medium whitespace-nowrap transition-colors",
                active === item
                  ? "text-primary"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {item.label}
              {active === item ? (
                <NavigationIndicator name={`section-active-${encodeURIComponent(label).replaceAll("%", "_")}`}
                  className="bg-primary pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5" />
              ) : null}
            </Link>
          ))}
        </nav>
      </ViewTransition>
    </LayoutGroup>
  );
}

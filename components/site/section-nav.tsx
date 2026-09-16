"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SectionNav({
  items,
  label,
}: {
  items: { href: string; label: string; matchNested?: boolean }[];
  label: string;
}) {
  const pathname = usePathname();
  const active =
    items.find((item) => pathname === item.href) ??
    items.find((item) => item.matchNested && pathname.startsWith(`${item.href}/`));
  return (
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
            "shrink-0 border-b-2 px-1 py-2.5 font-medium whitespace-nowrap transition-colors",
            active === item
              ? "border-primary text-primary"
              : "text-fg-muted hover:text-fg border-transparent",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

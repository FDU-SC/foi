"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SectionNav({
  items,
  label,
}: {
  items: { href: string; label: string }[];
  label: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="border-border flex min-w-0 gap-5 overflow-x-auto border-b text-sm"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
          className={cn(
            "shrink-0 border-b-2 px-1 py-2.5 font-medium whitespace-nowrap transition-colors",
            pathname === item.href
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

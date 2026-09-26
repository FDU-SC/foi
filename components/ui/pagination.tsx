import Link from "next/link";
import type { ReactNode } from "react";
import { PAGE_PARAM } from "@/lib/paging";
import { withParam, type SearchParams } from "@/lib/query";
import { cn } from "@/lib/utils";

/** The first, the last and the neighbours of the current page; `null` marks a gap. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((one) => one >= 1 && one <= pages)
    .sort((a, b) => a - b);

  return shown.flatMap((one, index) =>
    index > 0 && one - shown[index - 1] > 1 ? [null, one] : [one],
  );
}

/** Page links for a server-rendered list. A single page renders nothing. */
export function Pagination({
  path,
  params,
  page,
  pages,
}: {
  path: string;
  params: SearchParams;
  page: number;
  pages: number;
}) {
  if (pages <= 1) return null;

  const href = (to: number) =>
    path + withParam(params, PAGE_PARAM, to === 1 ? undefined : String(to));

  return (
    <nav aria-label="分页" className="flex flex-wrap items-center justify-center gap-1 text-sm">
      <PageLink href={page > 1 ? href(page - 1) : undefined}>上一页</PageLink>
      {pageWindow(page, pages).map((one, index) =>
        one === null ? (
          <span key={`gap-${index}`} className="text-fg-subtle px-1.5">
            …
          </span>
        ) : (
          <PageLink key={one} href={href(one)} current={one === page}>
            {one}
          </PageLink>
        ),
      )}
      <PageLink href={page < pages ? href(page + 1) : undefined}>下一页</PageLink>
    </nav>
  );
}

function PageLink({
  href,
  current = false,
  children,
}: {
  href?: string;
  current?: boolean;
  children: ReactNode;
}) {
  const className = cn(
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2.5 font-mono text-xs tabular-nums",
    current
      ? "border-primary/50 bg-primary-subtle text-primary"
      : "border-border text-fg-muted",
  );

  if (!href) {
    return <span aria-disabled className={cn(className, "opacity-45")}>{children}</span>;
  }
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(className, !current && "hover:border-border-strong hover:bg-surface-2 hover:text-fg")}
    >
      {children}
    </Link>
  );
}

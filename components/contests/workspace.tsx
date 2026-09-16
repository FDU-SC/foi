"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ProblemLink {
  href: string;
  label: string;
  title: string;
  points: number;
}

export function ContestWorkspace({ overviewHref, problems, empty, preview, children }: {
  overviewHref: string;
  problems: ProblemLink[];
  empty: string;
  preview: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const menu = useRef<HTMLDetailsElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (menu.current) menu.current.open = false;
    content.current?.scrollTo({ top: 0 });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      content.current?.scrollIntoView({ block: "start" });
    }
    content.current?.focus({ preventScroll: true });
  }, [pathname]);

  const navigation = (
    <nav aria-label="比赛题单" className="space-y-1 p-2">
      {[{ href: overviewHref, title: "比赛概览" }, ...problems].map((item) => (
        <Link key={item.href} href={item.href} scroll={false}
          aria-current={pathname === item.href ? "page" : undefined}
          onClick={() => { if (menu.current) menu.current.open = false; }}
          className={cn("block rounded-md px-3 py-2.5 text-sm break-words transition-colors", pathname === item.href
            ? "bg-primary/10 text-primary font-medium"
            : "text-fg-muted hover:bg-surface-2 hover:text-fg")}
        >
          {"label" in item ? <span className="mb-1 flex justify-between gap-2 font-mono text-xs"><span>{item.label}</span><span>{item.points} 分</span></span> : null}
          {item.title}
        </Link>
      ))}
      {preview ? <p className="text-warn px-3 py-2 text-xs">预览 · 尚未对选手公开</p> : null}
      {problems.length === 0 ? <p className="text-fg-muted px-3 py-4 text-xs leading-5">{empty}</p> : null}
    </nav>
  );

  return (
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="bg-surface border-border hidden max-h-[calc(100dvh-16rem)] overflow-y-auto rounded-lg border lg:block">{navigation}</aside>
      <details ref={menu} className="bg-surface border-border rounded-lg border lg:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{problems.find((problem) => problem.href === pathname)?.title ?? "比赛题单"}</summary>
        {navigation}
      </details>
      <div ref={content} tabIndex={-1} aria-label="比赛内容" className="min-w-0 scroll-mt-28 focus:outline-none lg:h-[calc(100dvh-16rem)] lg:min-h-96 lg:overflow-y-auto lg:pr-2">
        {children}
      </div>
    </div>
  );
}

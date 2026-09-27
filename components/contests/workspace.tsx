"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./workspace.module.css";

interface ProblemLink {
  href: string;
  label: string;
  title: string;
  points: number;
}

export function ContestWorkspace({ overviewHref, standingsHref, title, status, problems, empty, preview, showCount, children }: {
  overviewHref: string;
  standingsHref: string;
  title: string;
  status: ReactNode;
  problems: ProblemLink[];
  empty: string;
  preview: boolean;
  showCount: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const sidebarId = useId();
  const previousPath = useRef(pathname);
  const pendingNavigation = useRef<string | null>(null);
  const overview = pathname === overviewHref;
  const workspace = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const currentProblem = problems.find((problem) => problem.href === pathname);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const header = document.querySelector("[data-site-header]");
    const parts = header ? Array.from(header.children) : [];
    const measure = () => {
      const boxes = parts.map((part) => part.getBoundingClientRect()).filter((box) => box.height > 0);
      const height = boxes.length
        ? Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top))
        : 0;
      element.style.setProperty("--contest-header-height", `${height}px`);
    };
    const observer = new ResizeObserver(measure);
    parts.forEach((part) => observer.observe(part));
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (menu.current) menu.current.open = false;
    if (pendingNavigation.current === pathname) {
      window.scrollTo({ top: 0, behavior: "instant" });
      content.current?.focus({ preventScroll: true });
    }
    pendingNavigation.current = null;
  }, [pathname]);

  useEffect(() => {
    const cancelNavigation = () => { pendingNavigation.current = null; };
    window.addEventListener("popstate", cancelNavigation);
    return () => window.removeEventListener("popstate", cancelNavigation);
  }, []);

  const navigate = (href: string) => {
    if (menu.current) menu.current.open = false;
    pendingNavigation.current = href === pathname ? null : href;
  };

  const linkClass = (href: string) => cn(
    "border-l-2 py-1.5 pr-2 pl-3 text-sm transition-colors focus-visible:outline-offset-[-2px]",
    pathname === href
      ? "border-fg text-fg font-semibold"
      : "text-fg-muted hover:text-fg border-transparent",
  );
  const contestNavigation = (
    <nav aria-label="比赛导航" className="border-border mb-2 border-b py-2">
      <Link href={overviewHref} scroll={false} onNavigate={() => navigate(overviewHref)}
        aria-current={overview ? "page" : undefined}
        className={cn("block", linkClass(overviewHref))}>比赛概览</Link>
      <Link href={standingsHref} scroll={false} onNavigate={() => navigate(standingsHref)}
        aria-current={pathname === standingsHref ? "page" : undefined}
        className={cn("block", linkClass(standingsHref))}>排行榜</Link>
    </nav>
  );
  const heading = (
    <div className="flex items-baseline justify-between gap-3 py-2 pr-2 pl-3.5">
      <h2 className="text-sm font-semibold">题单</h2>
      {showCount ? <span aria-label="可见题目数量" className="text-fg-muted text-xs tabular-nums">{problems.length} 题</span> : null}
    </div>
  );
  const navigation = (
    <nav aria-label="比赛题单" className="pb-2">
      {preview ? <p className="text-warn py-2 pr-2 pl-3.5 text-xs leading-5">预览 · 尚未对选手公开</p> : null}
      <ul>
        {problems.map((item) => (
          <li key={item.href}>
            <Link href={item.href} scroll={false} onNavigate={() => navigate(item.href)}
              aria-current={pathname === item.href ? "page" : undefined}
              className={cn(styles.problemLink, linkClass(item.href))}
            >
              <span className="text-fg min-w-5 py-0.5 font-mono text-xs font-semibold wrap-anywhere">{item.label}</span>
              <span className="min-w-0 py-0.5">
                <span className="block leading-5 wrap-anywhere">{item.title}</span>
                <span className="text-fg-subtle mt-0.5 block text-xs font-normal tabular-nums">{item.points} 分</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {problems.length === 0 ? <p className="text-fg-muted py-4 pr-2 pl-3.5 text-xs leading-5">{empty}</p> : null}
    </nav>
  );

  return (
    <div ref={workspace} data-contest-workspace className={styles.root}>
      <header className={styles.toolbar}>
        {overview ? (
          <h1 className="min-w-0 text-xl font-bold wrap-anywhere">{title}</h1>
        ) : (
          <Link href={overviewHref} scroll={false} onNavigate={() => navigate(overviewHref)}
            className="text-fg-muted hover:text-fg min-w-0 text-sm font-medium wrap-anywhere">{title}</Link>
        )}
        {status}
        <button type="button" aria-expanded={expanded} aria-controls={sidebarId}
          onClick={() => setExpanded((value) => !value)}
          className="text-fg-muted hover:text-fg ml-auto hidden shrink-0 py-1 text-sm transition-colors lg:inline">
          {expanded ? "收起题单" : "展开题单"}
        </button>
      </header>
      <div className={cn(styles.workspace, expanded && styles.expanded)}>
        <details ref={menu} className="group border-border border-b lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 py-3 text-sm [&::-webkit-details-marker]:hidden">
            <span className="text-fg-muted shrink-0 text-xs">比赛导航</span>
            <span className="min-w-0 flex-1 font-medium wrap-anywhere">
              {currentProblem ? <><span className="mr-2 font-mono font-semibold">{currentProblem.label}</span>{currentProblem.title}</> : pathname === standingsHref ? "排行榜" : "比赛概览"}
            </span>
            <span aria-hidden="true" className="text-fg-subtle shrink-0 text-xs group-open:hidden">展开</span>
            <span aria-hidden="true" className="text-fg-subtle hidden shrink-0 text-xs group-open:inline">收起</span>
          </summary>
          {contestNavigation}
          {heading}
          {navigation}
        </details>
        <div ref={content} tabIndex={-1} role="region" aria-label="比赛内容" className={cn(styles.content, "min-w-0 focus-visible:outline-offset-[-2px]")}>
          {children}
        </div>
        <aside id={sidebarId} aria-hidden={!expanded} inert={!expanded}
          className={cn(styles.sidebar, "hidden min-h-0 flex-col lg:flex")}>
          <div className={styles.sidebarContent}>
            <div className="shrink-0">{contestNavigation}{heading}</div>
            <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

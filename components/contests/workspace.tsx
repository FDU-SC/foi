"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, ViewTransition, type ReactNode } from "react";
import { LayoutGroup } from "motion/react";
import { NavigationIndicator } from "@/components/ui/navigation-indicator";
import { PageTransition } from "@/components/ui/page-transition";
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
    "relative isolate rounded-md border-l-2 border-transparent px-2 py-2 text-sm transition-colors focus-visible:outline-offset-[-2px]",
    pathname === href
      ? "text-fg font-semibold"
      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
  );
  const activeMarker = (href: string, surface: "mobile" | "desktop") => pathname === href ? (
    <NavigationIndicator name={`workspace-active-${sidebarId}-${surface}`}
      className="border-primary bg-primary-subtle pointer-events-none absolute inset-y-0 -left-0.5 right-0 -z-10 rounded-md border-l-2" />
  ) : null;
  const contestNavigation = (surface: "mobile" | "desktop") => (
        <nav aria-label="比赛导航" className="mb-2 space-y-1 border-b p-2 pb-3">
          <Link href={overviewHref} scroll={false} onNavigate={() => navigate(overviewHref)}
            aria-current={overview ? "page" : undefined}
            className={cn("block", linkClass(overviewHref))}>{activeMarker(overviewHref, surface)}比赛概览</Link>
          <Link href={standingsHref} scroll={false} onNavigate={() => navigate(standingsHref)}
            aria-current={pathname === standingsHref ? "page" : undefined} className={cn("block", linkClass(standingsHref))}>{activeMarker(standingsHref, surface)}排行榜</Link>
        </nav>
  );
  const heading = (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <h2 className="text-sm font-semibold">题单</h2>
      {showCount ? <span aria-label="可见题目数量" className="text-fg-muted bg-surface-2 rounded-md px-2 py-0.5 text-xs tabular-nums">{problems.length} 题</span> : null}
    </div>
  );
  const navigation = (surface: "mobile" | "desktop") => (
    <nav aria-label="比赛题单" className="p-2">
      {preview ? <p className="text-warn px-3 py-2 text-xs leading-5">预览 · 尚未对选手公开</p> : null}
      <ul className="space-y-1">
        {problems.map((item) => (
          <li key={item.href}>
            <Link href={item.href} scroll={false} onNavigate={() => navigate(item.href)}
              aria-current={pathname === item.href ? "page" : undefined}
              className={cn(styles.problemLink, linkClass(item.href))}
            >
              {activeMarker(item.href, surface)}
              <span className={cn("min-w-7 py-0.5 text-center font-mono text-xs font-medium wrap-anywhere", pathname === item.href
                ? "text-primary"
                : "text-fg-muted")}>{item.label}</span>
              <span className="min-w-0 py-0.5">
                <span className="text-fg block leading-5 wrap-anywhere">{item.title}</span>
                <span className="text-fg-subtle mt-0.5 block text-xs font-normal tabular-nums">{item.points} 分</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {problems.length === 0 ? <p className="text-fg-muted px-3 py-4 text-xs leading-5">{empty}</p> : null}
    </nav>
  );

  return (
    <ViewTransition default="none" update="page-stable">
      <div ref={workspace} data-contest-workspace className={styles.root}>
        <header className={styles.toolbar}>
          {overview ? (
            <h1 className="min-w-0 text-2xl font-bold tracking-tight wrap-anywhere lg:text-3xl">{title}</h1>
          ) : (
            <Link href={overviewHref} scroll={false} onNavigate={() => navigate(overviewHref)}
              className="text-fg-muted hover:text-fg min-w-0 text-sm font-medium wrap-anywhere">{title}</Link>
          )}
          {status}
          <button type="button" aria-expanded={expanded} aria-controls={sidebarId}
            onClick={() => setExpanded((value) => !value)}
            className="text-fg bg-surface hover:bg-surface-2 ml-auto hidden shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium lg:inline-flex">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4"><rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M12.5 4v12" stroke="currentColor" strokeWidth="1.5" /><path d={expanded ? "m6 7 3 3-3 3" : "m9 7-3 3 3 3"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {expanded ? "收起" : "展开"}
          </button>
        </header>
        <div className={cn(styles.workspace, expanded && styles.expanded)}>
          <details ref={menu} className="group border-b lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
              <span className="text-fg-muted shrink-0 text-xs">比赛导航</span>
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                {currentProblem ? <><span className="text-primary mr-2 font-mono">{currentProblem.label}</span>{currentProblem.title}</> : pathname === standingsHref ? "排行榜" : "比赛概览"}
              </span>
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="text-fg-muted size-4 shrink-0 transition-transform group-open:rotate-180"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </summary>
            <LayoutGroup id={`${sidebarId}-mobile`}>
              {contestNavigation("mobile")}
              {heading}
              {navigation("mobile")}
            </LayoutGroup>
          </details>
          <PageTransition>
            <div ref={content} tabIndex={-1} role="region" aria-label="比赛内容" className={cn(styles.content, "min-w-0 focus-visible:outline-offset-[-2px]")}>
              {children}
            </div>
          </PageTransition>
          <aside id={sidebarId} aria-hidden={!expanded} inert={!expanded}
            className={cn(styles.sidebar, "hidden min-h-0 flex-col lg:flex")}>
            <div className={styles.sidebarContent}>
              <LayoutGroup id={`${sidebarId}-desktop`}>
                <div className="shrink-0">{contestNavigation("desktop")}{heading}</div>
                <div className="min-h-0 flex-1 overflow-y-auto">{navigation("desktop")}</div>
              </LayoutGroup>
            </div>
          </aside>
        </div>
      </div>
    </ViewTransition>
  );
}

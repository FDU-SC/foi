"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./workspace.module.css";

interface ProblemLink {
  href: string;
  label: string;
  title: string;
  points: number;
}

export function ContestWorkspace({ overviewHref, problems, empty, preview, showCount, children }: {
  overviewHref: string;
  problems: ProblemLink[];
  empty: string;
  preview: boolean;
  showCount: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const workspace = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const currentProblem = problems.find((problem) => problem.href === pathname);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Use the document offset so scrolling to the footer cannot grow the panels.
        const top = element.getBoundingClientRect().top + window.scrollY;
        const height = Math.max(320, window.innerHeight - top - 24);
        element.style.setProperty("--contest-workspace-height", `${height}px`);
      });
    };
    const observer = new ResizeObserver(measure);
    // Include chrome and title wrapping, not just changes to the viewport width.
    observer.observe(document.body);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (menu.current) menu.current.open = false;
    content.current?.scrollTo({ top: 0, behavior: "instant" });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      content.current?.scrollIntoView({ block: "start" });
    }
    content.current?.focus({ preventScroll: true });
  }, [pathname]);

  const linkClass = (href: string) => cn(
    "rounded-lg border-l-[3px] px-3 py-3 text-sm transition-colors focus-visible:outline-offset-[-2px]",
    pathname === href
      ? "border-primary bg-primary-subtle text-fg font-semibold"
      : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg",
  );
  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  const heading = (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5">
      <h2 className="text-sm font-semibold">题单</h2>
      {showCount ? <span aria-label="可见题目数量" className="text-fg-muted bg-surface-2 rounded-md px-2 py-0.5 text-xs tabular-nums">{problems.length} 题</span> : null}
    </div>
  );
  const navigation = (
    <nav aria-label="比赛题单" className="p-2">
      <div className="mb-2 border-b pb-2">
        <Link href={overviewHref} scroll={false} onClick={closeMenu}
          aria-current={pathname === overviewHref ? "page" : undefined}
          className={cn("block", linkClass(overviewHref))}
        >比赛概览</Link>
      </div>
      {preview ? <p className="text-warn px-3 py-2 text-xs leading-5">预览 · 尚未对选手公开</p> : null}
      <ul className="space-y-1">
        {problems.map((item) => (
          <li key={item.href}>
            <Link href={item.href} scroll={false} onClick={closeMenu}
              aria-current={pathname === item.href ? "page" : undefined}
              className={cn(styles.problemLink, linkClass(item.href))}
            >
              <span className={cn("min-w-9 rounded-md px-2 py-1.5 text-center font-mono text-sm font-semibold wrap-anywhere", pathname === item.href
                ? "bg-primary text-primary-fg"
                : "bg-surface-2 text-fg-muted")}>{item.label}</span>
              <span className="min-w-0 py-0.5">
                <span className="text-fg block leading-5 wrap-anywhere">{item.title}</span>
                <span className="text-fg-muted mt-1 block text-xs font-normal tabular-nums">{item.points} 分</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {problems.length === 0 ? <p className="text-fg-muted px-3 py-4 text-xs leading-5">{empty}</p> : null}
    </nav>
  );

  return (
    <div ref={workspace} className={styles.workspace}>
      <aside className={cn(styles.panel, styles.sidebar, "hidden min-h-0 flex-col lg:flex")}>
        <div className="shrink-0">{heading}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
      </aside>
      <details ref={menu} className={cn(styles.panel, "group lg:hidden")}>
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span className="text-fg-muted shrink-0 text-xs">题单</span>
          <span className="min-w-0 flex-1 font-medium wrap-anywhere">
            {currentProblem ? <><span className="text-primary mr-2 font-mono">{currentProblem.label}</span>{currentProblem.title}</> : "比赛概览"}
          </span>
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="text-fg-muted size-4 shrink-0 transition-transform group-open:rotate-180"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </summary>
        {heading}
        {navigation}
      </details>
      <div ref={content} tabIndex={-1} role="region" aria-label="比赛内容" className={cn(styles.content, "min-w-0 scroll-mt-28 rounded-xl focus-visible:outline-offset-[-2px]")}>
        {children}
      </div>
    </div>
  );
}

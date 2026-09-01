"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { QUICK } from "@/components/ui/motion";
import type { SessionUser } from "@/lib/authz/viewer";
import { cn } from "@/lib/utils";

const ITEM =
  "text-fg-muted hover:bg-surface-2 hover:text-fg block px-3 py-2 text-sm transition-colors";

export function UserMenu({
  user,
  groupNames,
}: {
  user: SessionUser;
  groupNames: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-surface-2 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
      >
        <Avatar of={user} />
        <span className="text-fg text-sm font-medium">{user.nickname}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={cn(
            "text-fg-subtle size-3 transition-transform duration-200",
            open && "rotate-180",
          )}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={QUICK}
            // Grows from the button it hangs off, rather than from its middle.
            className="border-border bg-surface/95 absolute right-0 z-50 mt-1.5 w-44 origin-top-right overflow-hidden rounded-xl border shadow-[0_16px_40px_-20px_oklch(20%_0.04_265/0.55)] backdrop-blur-xl"
          >
            <div className="border-border border-b px-3 py-2">
              <div className="text-fg font-mono text-xs">{user.username}</div>
              <div className="text-fg-subtle text-[11px]">
                {groupNames.join(" · ") || "选手"}
              </div>
            </div>
            <Link
              href={`/u/${user.username}`}
              onClick={() => setOpen(false)}
              className={ITEM}
            >
              个人主页
            </Link>
            <Link
              href="/submissions"
              onClick={() => setOpen(false)}
              className={ITEM}
            >
              我的提交
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className={ITEM}
            >
              个人设置
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="text-fg-muted hover:bg-surface-2 hover:text-err w-full px-3 py-2 text-left text-sm transition-colors"
              >
                退出登录
              </button>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

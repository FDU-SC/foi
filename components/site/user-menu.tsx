"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/actions/auth";
import type { SessionUser } from "@/lib/auth/session";

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
        <span className="bg-primary-subtle text-primary flex size-6 items-center justify-center rounded-full text-xs font-semibold">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-fg text-sm font-medium">{user.displayName}</span>
      </button>

      {open ? (
        <div className="border-border bg-surface absolute right-0 mt-1.5 w-44 overflow-hidden rounded-lg border shadow-lg">
          <div className="border-border border-b px-3 py-2">
            <div className="text-fg font-mono text-xs">{user.handle}</div>
            <div className="text-fg-subtle text-[11px]">
              {groupNames.join(" · ") || "选手"}
            </div>
          </div>
          <Link
            href="/submissions"
            onClick={() => setOpen(false)}
            className="text-fg-muted hover:bg-surface-2 hover:text-fg block px-3 py-2 text-sm transition-colors"
          >
            我的提交
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-fg-muted hover:bg-surface-2 hover:text-err w-full px-3 py-2 text-left text-sm transition-colors"
            >
              退出登录
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

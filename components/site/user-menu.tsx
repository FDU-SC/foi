"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { logout } from "@/app/actions/auth";
import { useDismiss } from "@/components/ui/use-dismiss";
import { profileHref } from "@/lib/accounts/profile";
import type { SessionUser } from "@/lib/authz/viewer";

const ITEM =
  "text-fg-muted hover:bg-surface-2 hover:text-fg block px-3 py-2 text-sm transition-colors";

export function UserMenu({
  user,
  groupNames,
  links = [],
}: {
  user: SessionUser;
  groupNames: string[];
  links?: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-fg hover:text-fg-muted flex items-center gap-1.5 py-1.5 text-sm font-medium transition-colors"
      >
        {user.nickname}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-fg-subtle size-3"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="border-border bg-surface absolute right-0 z-50 mt-1.5 w-44 border">
          <div className="border-border border-b px-3 py-2">
            <div className="text-fg font-mono text-xs">{user.username}</div>
            <div className="text-fg-subtle text-[11px]">
              {groupNames.join(" · ") || "选手"}
            </div>
          </div>
          <Link
            href={profileHref(user.username)}
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
          {links.length > 0 ? (
            <div className="border-border border-t">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={ITEM}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}
          <form action={logout} className="border-border border-t">
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

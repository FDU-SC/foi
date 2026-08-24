import Link from "next/link";
import { getSessionUser } from "@/auth";
import { viewerFor } from "@/lib/auth/viewer";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { UserMenu } from "@/components/site/user-menu";

const NAV = [
  { href: "/problems", label: "题库" },
  { href: "/contests", label: "比赛" },
  { href: "/submissions", label: "提交记录" },
  { href: "/judges", label: "判题机" },
] as const;

export async function Header() {
  const user = await getSessionUser();

  return (
    <header className="border-border bg-bg/85 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link
          href="/"
          className="text-fg shrink-0 text-base font-bold tracking-tight"
        >
          FOI
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-fg-muted hover:text-fg hover:bg-surface-2 rounded-md px-2.5 py-1.5 transition-colors"
            >
              {item.label}
            </Link>
          ))}
          {viewerFor(user).can("admin.access") ? (
            <Link
              href="/admin"
              className="text-fg-muted hover:text-fg hover:bg-surface-2 rounded-md px-2.5 py-1.5 transition-colors"
            >
              管理
            </Link>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <UserMenu user={user} />
          ) : (
            <Link
              href="/login"
              className="bg-primary text-primary-fg hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            >
              登录
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

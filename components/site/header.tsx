import Link from "next/link";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { groupName } from "@/lib/authz/groups";
import { viewerFor } from "@/lib/authz/viewer";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";
import { Brand } from "@/components/site/brand";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { UserMenu } from "@/components/site/user-menu";

export async function DefaultHeader() {
  const user = await getSessionUser();
  const viewer = viewerFor(user);

  return (
    <header className="border-border bg-bg/85 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <div className="shrink-0 text-base">
          <Brand />
        </div>

        <nav className="flex items-center gap-1 text-sm">
          {site.navigation
            .filter(
              (item) =>
                !item.visibleWhen || allows(item.visibleWhen, null, viewer),
            )
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-fg-muted hover:text-fg hover:bg-surface-2 rounded-md px-2.5 py-1.5 transition-colors"
              >
                {item.label}
              </Link>
            ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <UserMenu
              user={user}
              groupNames={user.groups.map(groupName)}
            />
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

export function Header() {
  const Slot = siteViews.Header;
  return Slot ? <Slot /> : <DefaultHeader />;
}

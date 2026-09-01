import Link from "next/link";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { groupName } from "@/lib/authz/groups";
import { viewerFor } from "@/lib/authz/viewer";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";
import { Brand } from "@/components/site/brand";
import { SiteNav } from "@/components/site/site-nav";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { UserMenu } from "@/components/site/user-menu";

export async function DefaultHeader() {
  const user = await getSessionUser();
  const viewer = viewerFor(user);

  return (
    <header className="border-border/80 bg-bg/75 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <div className="shrink-0 text-base">
          <Brand />
        </div>

        <SiteNav
          items={site.navigation
            .filter(
              (item) =>
                !item.visibleWhen || allows(item.visibleWhen, null, viewer),
            )
            .map(({ href, label }) => ({ href, label }))}
        />

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
              className="bg-primary text-primary-fg hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium shadow-[0_0_20px_-4px_var(--primary)] transition-[background-color,box-shadow,transform] duration-200 hover:shadow-[0_0_28px_-2px_var(--primary)] motion-safe:active:scale-[0.98]"
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

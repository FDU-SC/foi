import Link from "next/link";
import { getSessionUser } from "@/auth";
import { navigationFor } from "@/lib/site-navigation";
import { groupName } from "@/lib/authz/groups";
import { viewerFor } from "@/lib/authz/viewer";
import { siteViews } from "@/lib/site-views";
import { Brand } from "@/components/site/brand";
import { SiteNav } from "@/components/site/site-nav";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { UserMenu } from "@/components/site/user-menu";

export async function DefaultHeader() {
  const user = await getSessionUser();
  const viewer = viewerFor(user);

  return (
    <header className="border-border bg-bg sticky top-0 z-40 border-b">
      <div className="site-container mx-auto flex min-h-12 flex-wrap items-center gap-x-8 px-4 md:px-6">
        <div className="flex h-12 shrink-0 items-center text-lg">
          <Brand />
        </div>

        <SiteNav items={navigationFor(viewer)} />

        <div className="ml-auto flex h-12 shrink-0 items-center gap-4">
          <ThemeToggle />
          {user ? (
            <UserMenu
              user={user}
              groupNames={user.groups.map(groupName)}
              links={navigationFor(viewer, "account")}
            />
          ) : (
            <Link
              href="/login"
              className="text-fg hover:text-fg-muted text-sm font-medium transition-colors"
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

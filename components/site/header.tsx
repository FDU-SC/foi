import Link from "next/link";
import { ViewTransition } from "react";
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
    <header className="border-border/80 bg-bg/80 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="site-container mx-auto flex min-h-14 flex-wrap items-center gap-x-6 px-4 md:px-6">
        <ViewTransition default="header-move" enter="none" exit="none">
          <div className="flex h-14 shrink-0 items-center text-base">
            <Brand />
          </div>
        </ViewTransition>

        <ViewTransition default="header-move" enter="none" exit="none">
          <SiteNav
            items={navigationFor(viewer)}
          />
        </ViewTransition>

        <ViewTransition default="header-move" enter="none" exit="none">
          <div className="ml-auto flex h-14 shrink-0 items-center gap-2">
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
                className="ui-primary bg-primary text-primary-fg hover:bg-primary-hover rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,box-shadow,transform] duration-200 motion-safe:active:scale-[0.98]"
              >
                登录
              </Link>
            )}
          </div>
        </ViewTransition>
      </div>
    </header>
  );
}

export function Header() {
  const Slot = siteViews.Header;
  return Slot ? <Slot /> : <DefaultHeader />;
}

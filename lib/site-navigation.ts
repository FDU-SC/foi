import "server-only";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { site, type NavItem } from "@/lib/site";
import { siteViews } from "@/lib/site-views";

/** Resolve placement and permissions before passing links to client components. */
export function navigationFor(
  viewer: Viewer,
  location: NonNullable<NavItem["location"]> = "primary",
): { href: string; label: string }[] {
  return site.navigation
    .filter((item) =>
      (item.location ?? "primary") === location &&
      (item.href !== "/leaderboard" || Boolean(siteViews.Leaderboard)) &&
      (!item.visibleWhen || allows(item.visibleWhen, null, viewer)),
    )
    .map(({ href, label }) => ({ href, label }));
}

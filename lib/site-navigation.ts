import "server-only";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { catalogueBoardSections, leaderboardHref } from "@/lib/contests/catalogue";
import { site, type NavItem } from "@/lib/site";

/** Resolve placement and permissions before passing links to client components. */
export function navigationFor(
  viewer: Viewer,
  location: NonNullable<NavItem["location"]> = "primary",
): { href: string; label: string }[] {
  return site.navigation
    .filter((item) =>
      (item.location ?? "primary") === location &&
      (item.href !== leaderboardHref() || (catalogueBoardSections() ?? []).length > 0) &&
      (!item.visibleWhen || allows(item.visibleWhen, null, viewer)),
    )
    .map(({ href, label }) => ({ href, label }));
}

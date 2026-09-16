import Link from "next/link";
import type { Viewer } from "@/lib/authz/viewer";
import type { NavItem } from "@/lib/site";
import { navigationFor } from "@/lib/site-navigation";

export function NavigationLinks({
  viewer,
  location,
}: {
  viewer: Viewer;
  location: NonNullable<NavItem["location"]>;
}) {
  return navigationFor(viewer, location).map(({ href, label }) => (
    <Link
      key={href}
      href={href}
      className="text-fg-muted hover:text-primary rounded-sm text-sm transition-colors hover:underline"
    >
      {label}
    </Link>
  ));
}

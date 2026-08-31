import Link from "next/link";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";

/**
 * Renders the mark itself and nothing around it: size, margin and alignment
 * come from whichever container it sits in, so the same slot serves the header
 * and the auth pages.
 */
export function DefaultBrand() {
  return (
    <Link href="/" className="text-fg font-bold tracking-tight">
      {site.name}
    </Link>
  );
}

export function Brand() {
  const Slot = siteViews.Brand;
  return Slot ? <Slot /> : <DefaultBrand />;
}

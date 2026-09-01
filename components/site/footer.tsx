import Link from "next/link";
import { getSessionUser } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";

export async function DefaultFooter() {
  const links = site.footer?.links ?? [];
  const gated = links.some((link) => link.visibleWhen);
  const viewer = gated ? viewerFor(await getSessionUser()) : null;

  const visible = links.filter(
    (link) =>
      !link.visibleWhen || (viewer && allows(link.visibleWhen, null, viewer)),
  );

  return (
    <footer className="border-border/80 text-fg-subtle relative z-10 border-t px-4 py-8 text-center text-xs">
      <p>{site.footer?.text ?? `${site.name} · ${site.description}`}</p>
      {visible.length > 0 ? (
        <p className="mt-2 flex flex-wrap justify-center gap-4">
          {visible.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-fg transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </p>
      ) : null}
    </footer>
  );
}

export function Footer() {
  const Slot = siteViews.Footer;
  return Slot ? <Slot /> : <DefaultFooter />;
}

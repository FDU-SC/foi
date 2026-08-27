import Link from "next/link";
import type { ReactNode } from "react";
import { site } from "@/lib/site";

export function AuthShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xs">
        <Link
          href="/"
          className="text-fg mb-8 block text-center text-2xl font-bold tracking-tight"
        >
          {site.name}
        </Link>
        {children}
        {footer ? (
          <p className="text-fg-subtle mt-6 text-center text-xs leading-relaxed">
            {footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}

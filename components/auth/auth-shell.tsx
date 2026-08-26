import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around every page that is reached while signed out — logging in,
 * registering, asking for a password reset, setting the new one. There are
 * four of them, and they only differ in the form in the middle.
 */
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
          FOI
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

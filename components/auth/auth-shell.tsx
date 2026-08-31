import type { ReactNode } from "react";
import { Brand } from "@/components/site/brand";
import { siteViews } from "@/lib/site-views";

export function DefaultAuthShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xs">
        <div className="mb-8 text-center text-2xl">
          <Brand />
        </div>
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

export function AuthShell(props: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  const Slot = siteViews.AuthShell;
  return Slot ? <Slot {...props} /> : <DefaultAuthShell {...props} />;
}

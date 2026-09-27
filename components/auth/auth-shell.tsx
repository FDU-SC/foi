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
    <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-80">
        <div className="border-fg mb-6 border-b pb-3 text-2xl">
          <Brand />
        </div>
        {children}
        {footer ? (
          <p className="text-fg-muted border-border mt-6 border-t pt-4 text-xs leading-relaxed">
            {footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function AuthShell(props: { children: ReactNode; footer?: ReactNode }) {
  const Slot = siteViews.AuthShell;
  return Slot ? <Slot {...props} /> : <DefaultAuthShell {...props} />;
}

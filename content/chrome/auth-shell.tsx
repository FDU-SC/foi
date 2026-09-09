import type { ReactNode } from "react";
import { Brand } from "@/components/site/brand";

export function FoiAuthShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-16">
      <div className="foi-auth border-border bg-surface/85 relative w-full max-w-sm rounded-xl border px-6 py-6 backdrop-blur-xl">
        <div className="mb-6 text-center text-2xl">
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

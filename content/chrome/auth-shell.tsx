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
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="foi-orb foi-orb-a top-1/4 left-1/2 -translate-x-1/2" />
        <div className="foi-orb foi-orb-b top-1/3 right-1/4" />
      </div>
      <div className="foi-auth border-border bg-surface/70 w-full max-w-sm rounded-2xl border px-6 py-8 backdrop-blur-xl">
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

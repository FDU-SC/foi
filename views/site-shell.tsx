import type { ReactNode } from "react";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="group/shell flex min-h-full flex-1 flex-col has-[[data-workspace]]:h-dvh has-[[data-workspace]]:overflow-hidden">
      <Header />
      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-8 has-[[data-workspace]]:mx-0 has-[[data-workspace]]:flex has-[[data-workspace]]:min-h-0 has-[[data-workspace]]:max-w-none has-[[data-workspace]]:flex-col has-[[data-workspace]]:px-0 has-[[data-workspace]]:py-0">
        {children}
      </main>
      <div className="group-has-[[data-workspace]]/shell:hidden">
        <Footer />
      </div>
    </div>
  );
}

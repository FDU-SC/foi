import type { ReactNode } from "react";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { PageTransition } from "@/components/ui/page-transition";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="contents" data-site-header><Header /></div>
      <PageTransition>
        <main className="oj-page site-container relative z-10 mx-auto w-full min-w-0 flex-1 px-4 py-5 md:px-6">
          {children}
        </main>
      </PageTransition>
      <Footer />
    </>
  );
}

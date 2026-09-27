import type { ReactNode } from "react";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="contents" data-site-header><Header /></div>
      <main className="oj-page site-container relative z-20 mx-auto w-full min-w-0 flex-1 px-4 py-6 md:px-6">
        {children}
      </main>
      <Footer />
    </>
  );
}

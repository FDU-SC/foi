import type { ReactNode } from "react";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="contents" data-site-header><Header /></div>
      <main className="oj-page relative z-10 mx-auto w-full max-w-[1280px] min-w-0 flex-1 px-4 py-5 md:px-6">
        {children}
      </main>
      <Footer />
    </>
  );
}

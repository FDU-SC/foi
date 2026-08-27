import { Header } from "@/components/site/header";
import { site } from "@/lib/site";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-border text-fg-subtle border-t px-4 py-6 text-center text-xs">
        {site.name} · {site.description}
      </footer>
    </>
  );
}

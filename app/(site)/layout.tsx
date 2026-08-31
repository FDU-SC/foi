import { SiteShell } from "@/views/site-shell";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <SiteShell>{children}</SiteShell>;
}

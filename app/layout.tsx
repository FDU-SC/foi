import type { Metadata } from "next";
import { site } from "@/lib/site";
import { RootShell } from "@/views/root-shell";
import "./globals.css";
import "@/lib/theme";

export const metadata: Metadata = {
  title: {
    default: site.name,
    template: `%s · ${site.name}`,
  },
  description: site.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <RootShell>{children}</RootShell>;
}

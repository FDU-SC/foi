import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { site } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Runs before first paint so a dark-mode reader never sees a light flash. It
// cannot be a component: the class has to be on <html> before React hydrates.
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("foi-theme");
    var dark = stored ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export function RootShell({ children }: { children: ReactNode }) {
  return (
    <html
      lang={site.lang}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}

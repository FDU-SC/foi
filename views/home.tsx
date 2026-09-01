import Link from "next/link";
import { HomeHero } from "@/components/site/home-hero";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Lines the hero reveals before the page hands off to the entry cards. */
const HERO_LINES = 3;

export function HomeView() {
  return (
    <div className="space-y-12">
      <HomeHero />

      <section className="grid gap-3 sm:grid-cols-3">
        {(site.homeEntries ?? []).map((entry, index) => (
          <Link
            key={entry.href}
            href={entry.href}
            // Picks up where the hero's three lines left off, so the page
            // arrives as one cascade rather than two overlapping ones.
            style={revealDelay(index + HERO_LINES)}
            className={cn(
              "ui-lift border-border bg-surface/80 hover:border-primary/40 hover:bg-surface group rounded-xl border p-5",
              "shadow-[0_1px_0_oklch(100%_0_0/0.04)] hover:shadow-[0_16px_40px_-24px_var(--primary)]",
              revealClass,
            )}
          >
            <div className="text-fg group-hover:text-primary flex items-center gap-1.5 font-semibold transition-colors">
              {entry.title}
              <span
                aria-hidden
                className="text-primary -translate-x-1 opacity-0 transition-[transform,opacity] duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100"
              >
                →
              </span>
            </div>
            <p className="text-fg-muted mt-1.5 text-sm leading-6">
              {entry.description}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}

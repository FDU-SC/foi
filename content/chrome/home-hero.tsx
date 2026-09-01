import { revealClass, revealDelay } from "@/components/ui/reveal";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export function FoiHomeHero() {
  return (
    <section className="relative pt-10 pb-2 sm:pt-16">
      <div
        className="pointer-events-none absolute -inset-x-16 -top-24 bottom-0"
        aria-hidden
      >
        <div className="foi-orb foi-orb-a" />
        <div className="foi-orb foi-orb-b" />
      </div>

      {/* Three lines arriving in order; `views/home.tsx` continues the count
          so the entry cards below fall in behind them. */}
      <p
        style={revealDelay(0)}
        className={cn(
          "text-primary mb-4 font-mono text-[11px] font-medium tracking-[0.32em] uppercase",
          revealClass,
        )}
      >
        竞赛平台
      </p>
      <h1
        style={revealDelay(1)}
        className={cn(
          "foi-display w-fit text-6xl leading-none font-bold tracking-tighter sm:text-8xl",
          revealClass,
        )}
      >
        {site.name}
      </h1>
      <p
        style={revealDelay(2)}
        className={cn(
          "text-fg-muted mt-6 max-w-2xl text-base leading-7 sm:text-lg",
          revealClass,
        )}
      >
        {site.tagline ?? site.description}
      </p>
    </section>
  );
}

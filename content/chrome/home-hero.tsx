import { site } from "@/lib/site";
import { revealClass } from "@/components/ui/reveal";

export function FoiHomeHero() {
  return (
    <section className={`foi-home-hero px-5 py-5 sm:px-7 ${revealClass}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="foi-orb foi-orb-a" />
        <div className="foi-orb foi-orb-b" />
      </div>
      <div className="relative">
        <p className="text-primary mb-2 text-xs font-medium tracking-[0.22em]">
          竞赛平台
        </p>
        <h1 className="foi-display w-fit text-3xl leading-none font-bold tracking-tight sm:text-4xl">
          {site.name}
        </h1>
        <p className="text-fg-muted mt-2 max-w-2xl text-sm leading-6">
          {site.tagline ?? site.description}
        </p>
      </div>
    </section>
  );
}

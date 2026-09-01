import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";

export function DefaultHomeHero() {
  return (
    <section className="pt-8">
      <h1 className="text-fg text-4xl font-bold tracking-tight">{site.name}</h1>
      <p className="text-fg-muted mt-3 max-w-2xl leading-7">
        {site.tagline ?? site.description}
      </p>
    </section>
  );
}

export function HomeHero() {
  const Slot = siteViews.HomeHero;
  return Slot ? <Slot /> : <DefaultHomeHero />;
}

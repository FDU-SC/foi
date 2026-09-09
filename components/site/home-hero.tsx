import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";

export function DefaultHomeHero() {
  return (
    <section className="border-border border-b pb-5">
      <h1 className="text-fg text-2xl font-bold tracking-tight">{site.name}</h1>
      <p className="text-fg-muted mt-1 max-w-2xl text-sm leading-6">
        {site.tagline ?? site.description}
      </p>
    </section>
  );
}

export function HomeHero() {
  const Slot = siteViews.HomeHero;
  return Slot ? <Slot /> : <DefaultHomeHero />;
}

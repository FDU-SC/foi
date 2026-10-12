import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";

/** The brand already heads every page, so the home page opens with one line. */
export function DefaultHomeHero() {
  return (
    <section>
      <h1 className="sr-only">{site.name}</h1>
      <p className="text-fg-muted text-sm">{site.tagline ?? site.description}</p>
    </section>
  );
}

export function HomeHero() {
  const Slot = siteViews.HomeHero;
  return Slot ? <Slot /> : <DefaultHomeHero />;
}

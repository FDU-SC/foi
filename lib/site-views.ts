import type { ReactNode } from "react";
import { views as declared } from "@/content/site-views";

/**
 * A slot may be an async server component, which `ComponentType` does not
 * describe. Everything a slot needs beyond its props it reads from the same
 * platform APIs the default implementation uses.
 */
type Slot<P = object> = (props: P) => ReactNode | Promise<ReactNode>;

/**
 * The chrome around every page, as replaceable parts.
 *
 * Each slot has a platform default, so an empty object is a complete
 * implementation. Filling one replaces that part outright — this is for
 * changing a region's structure. Wording and links that fit the default
 * structure belong in `SiteConfig` instead, and a page whose whole body needs
 * rewriting is a `views.local/` override.
 */
export interface SiteViews {
  /** The top bar: brand, navigation, session controls. */
  Header?: Slot;

  /** The strip below every page in the site shell. */
  Footer?: Slot;

  /** The wordmark, shown in the header and above each auth form. */
  Brand?: Slot;

  /** The introduction above the home page's entry cards. */
  HomeHero?: Slot;

  /** The centred shell each auth page renders its form inside. */
  AuthShell?: Slot<{ children: ReactNode; footer?: ReactNode }>;
}

export const siteViews: SiteViews = declared;

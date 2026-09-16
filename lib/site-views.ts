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
 * Every slot is optional. Chrome slots have defaults; optional content
 * regions are omitted and an absent Leaderboard returns 404. Filling one
 * replaces that region's structure. Wording and links that fit the default
 * structure belong in `SiteConfig` instead, and a page whose whole body needs
 * rewriting is a `views.local/` override.
 */
export interface SiteViews {
  /** Optional full leaderboard; the platform authorizes before mounting it. */
  Leaderboard?: Slot;

  /** Optional home summary, mounted only when leaderboard.read is allowed. */
  HomeLeaderboard?: Slot;

  /** Body for a published site.announcements entry; absent uses its summary. */
  AnnouncementBody?: Slot<{ slug: string }>;

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

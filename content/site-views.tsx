import type { SiteViews } from "@/lib/site-views";
import { FoiAuthShell } from "./chrome/auth-shell";
import { FoiBrand } from "./chrome/brand";
import { FoiHomeHero } from "./chrome/home-hero";

/**
 * FOI chrome: the wordmark, the home introduction, and the auth frame.
 * Header and Footer keep the platform structure and pick up atmosphere from
 * the theme stylesheet.
 */
export const views: SiteViews = {
  Brand: FoiBrand,
  HomeHero: FoiHomeHero,
  AuthShell: FoiAuthShell,
};

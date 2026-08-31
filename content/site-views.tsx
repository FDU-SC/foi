import type { SiteViews } from "@/lib/site-views";

/**
 * Replacements for the chrome around every page.
 *
 * Every slot has a platform default, so declaring none — as here — renders the
 * stock site. Fill one to replace that region's structure; see `SiteViews` for
 * what each covers and `content/site.ts` for the wording that needs no code.
 */
export const views: SiteViews = {};

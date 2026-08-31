import type { SiteViews } from "@/lib/site-views";

/**
 * No slot filled: kernel tests describe the platform's own chrome. A test that
 * needs a slot to be occupied should fill it locally rather than here, so the
 * default path stays the one every other suite exercises.
 */
export const views: SiteViews = {};

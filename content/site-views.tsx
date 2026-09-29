import type { SiteViews } from "@/lib/site-views";
import { FoiHomeLeaderboard } from "./chrome/home-leaderboard";

/**
 * FOI chrome: the home summary of the catalogue leaderboard. Every other
 * region keeps the platform default.
 */
export const views: SiteViews = {
  HomeLeaderboard: FoiHomeLeaderboard,
};

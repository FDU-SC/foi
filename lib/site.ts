import type { SiteActionId } from "@/lib/authz/actions";
import { site as declared } from "@/content/site";

export interface NavItem {
  href: string;
  label: string;

  /**
   * Hide the link unless this action is permitted. It names the same action the
   * destination enforces, so the nav cannot drift from what the page allows.
   */
  visibleWhen?: SiteActionId;
}

export interface HomeEntry {
  href: string;
  title: string;
  description: string;
}

export interface SiteConfig {
  name: string;
  title: string;
  description: string;
  lang: string;
  timezone: string;
  navigation: NavItem[];
  homeEntries?: HomeEntry[];
  passwordMinLength?: number;
}

export const site: SiteConfig = declared;

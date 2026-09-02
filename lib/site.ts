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

export interface FooterConfig {
  /** Replaces the default `name · description` line. */
  text?: string;
  links?: NavItem[];
}

export interface SiteConfig {
  name: string;
  title: string;
  description: string;
  lang: string;
  timezone: string;
  navigation: NavItem[];

  /**
   * The contests this deployment presents as a catalogue, named by their slugs.
   *
   * A problem is reachable only as part of a contest, and this moves where
   * those contests' pairs are reachable: `/problems/<contest>/<problem>` rather
   * than `/contests/<contest>/problems/<problem>`. Each pair still has exactly
   * one URL. Omit it and every contest stays under `/contests`.
   *
   * The order is the order `/problems` presents them in, and the order their
   * `domain` headings first appear in.
   */
  catalogue?: string[];

  /** The line under the name on the home page. Falls back to `description`. */
  tagline?: string;

  homeEntries?: HomeEntry[];
  passwordMinLength?: number;

  /**
   * Wording and links in the footer. Anything structural — columns, a logo, a
   * QR code — is a `Footer` slot in `content/site-views.tsx` instead.
   */
  footer?: FooterConfig;
}

export const site: SiteConfig = declared;

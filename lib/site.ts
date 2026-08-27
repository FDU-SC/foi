import type { Capability } from "@/lib/permissions/policy";
import { site as declared } from "@/content/site";

export interface NavItem {
  href: string;
  label: string;
  capability?: Capability;
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

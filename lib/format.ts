import { site } from "@/lib/site";

export function dateFormatter(
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(site.lang, {
    timeZone: site.timezone,
    ...options,
  });
}

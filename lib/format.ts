import { site } from "@/lib/site";

export function dateFormatter(
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(site.lang, {
    timeZone: site.timezone,
    ...options,
  });
}

const moment = dateFormatter({ dateStyle: "long", timeStyle: "short" });

/** A date and time in the site's language and timezone, as prose and emails name one. */
export function formatMoment(at: Date): string {
  return moment.format(at);
}

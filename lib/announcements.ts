import { site, type Announcement } from "@/lib/site";

export function publishedAnnouncements(
  entries: readonly Announcement[] = site.announcements ?? [],
  now = new Date(),
): Announcement[] {
  return entries
    .filter(
      (entry) =>
        /(?:Z|[+-]\d{2}:\d{2})$/.test(entry.publishedAt) &&
        Date.parse(entry.publishedAt) <= now.getTime(),
    )
    .toSorted(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
}

export function announcementFor(slug: string, now = new Date()) {
  return publishedAnnouncements(undefined, now).find(
    (entry) => entry.slug === slug,
  );
}

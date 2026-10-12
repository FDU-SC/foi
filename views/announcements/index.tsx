import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { publishedAnnouncements } from "@/lib/announcements";
import { dateFormatter } from "@/lib/format";

const formatter = dateFormatter({ dateStyle: "long" });
export function AnnouncementListView() {
  const entries = publishedAnnouncements();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="公告" />
      {entries.length ? (
        <ul className="border-fg border-t">
          {entries.map((entry) => (
            <li key={entry.slug} className="border-border space-y-1.5 border-b py-4">
              <h2 className="flex flex-wrap items-baseline gap-2 text-base font-semibold break-words">
                {entry.pinned && <Badge tone="primary">置顶</Badge>}
                <Link
                  href={`/announcements/${entry.slug}`}
                  className="underline-offset-2 hover:underline"
                >
                  {entry.title}
                </Link>
              </h2>
              <p className="text-fg-muted text-sm leading-6 break-words">
                {entry.summary}
              </p>
              <time
                className="text-fg-subtle text-xs tabular-nums"
                dateTime={entry.publishedAt}
              >
                {formatter.format(new Date(entry.publishedAt))}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>暂无公告。</EmptyState>
      )}
    </div>
  );
}

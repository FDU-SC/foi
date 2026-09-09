import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { publishedAnnouncements } from "@/lib/announcements";
import { dateFormatter } from "@/lib/format";

const formatter = dateFormatter({ dateStyle: "long" });
export function AnnouncementListView() {
  const entries = publishedAnnouncements();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="公告" />
      {entries.length ? (
        <ul className="ui-panel divide-y divide-border rounded-lg border border-border bg-surface">
          {entries.map((entry) => (
            <li key={entry.slug} className="space-y-2 p-5">
              <h2 className="text-base font-semibold break-words">
                {entry.pinned && (
                  <Badge tone="primary" className="mr-2">
                    置顶
                  </Badge>
                )}
                <Link
                  href={`/announcements/${entry.slug}`}
                  className="hover:text-primary"
                >
                  {entry.title}
                </Link>
              </h2>
              <p className="text-fg-muted text-sm leading-6 break-words">
                {entry.summary}
              </p>
              <time
                className="text-fg-subtle text-xs"
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

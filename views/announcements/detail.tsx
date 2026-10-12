import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page";
import { announcementFor } from "@/lib/announcements";
import { siteViews } from "@/lib/site-views";
import { dateFormatter } from "@/lib/format";

export async function announcementMetadata({
  params,
}: PageProps<"/announcements/[slug]">) {
  const entry = announcementFor((await params).slug);
  return { title: entry?.title ?? "公告不存在" };
}

export async function AnnouncementDetailView({
  params,
}: PageProps<"/announcements/[slug]">) {
  const entry = announcementFor((await params).slug);
  if (!entry) notFound();
  const Body = siteViews.AnnouncementBody;
  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href="/announcements"
        className="text-fg-muted hover:text-fg text-xs transition-colors"
      >
        公告
      </Link>
      <PageHeader
        title={entry.title}
        description={dateFormatter({
          dateStyle: "long",
          timeStyle: "short",
        }).format(new Date(entry.publishedAt))}
      />
      <article className="oj-statement border-fg min-w-0 border-t pt-2">
        {Body ? (
          <Body slug={entry.slug} />
        ) : (
          <p className="text-base leading-[1.85] break-words whitespace-pre-wrap">
            {entry.summary}
          </p>
        )}
      </article>
    </div>
  );
}

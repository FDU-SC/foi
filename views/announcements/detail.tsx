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
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/announcements"
        className="text-fg-muted text-sm hover:text-primary"
      >
        ← 公告
      </Link>
      <PageHeader
        title={entry.title}
        description={dateFormatter({
          dateStyle: "long",
          timeStyle: "short",
        }).format(new Date(entry.publishedAt))}
      />
      <article className="oj-statement min-w-0 overflow-hidden p-5 sm:p-7">
        {Body ? (
          <Body slug={entry.slug} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-base leading-8">
            {entry.summary}
          </p>
        )}
      </article>
    </div>
  );
}

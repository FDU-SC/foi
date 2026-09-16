import Link from "next/link";
import { Suspense } from "react";
import { getViewer } from "@/auth";
import { HomeHero } from "@/components/site/home-hero";
import { HomePanel, HomePanelSkeleton } from "@/components/ui/home-panel";
import { Badge } from "@/components/ui/badge";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { QueueBadge } from "@/components/problem/queue-position";
import { site } from "@/lib/site";
import { siteViews } from "@/lib/site-views";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import {
  catalogueSlugs,
  contestHref,
  problemHref,
} from "@/lib/contests/catalogue";
import { contestFor, contestsFor } from "@/lib/contests/access";
import { contestStatus } from "@/lib/contests/types";
import { problemFor } from "@/lib/problems/access";
import { dateFormatter } from "@/lib/format";
import { publishedAnnouncements } from "@/lib/announcements";
import { homeSubmissions, recentPractice, recentContests } from "@/lib/home";
import { locateInQueues } from "@/lib/submissions/queue-position";
import { isSettled } from "@/lib/backend/types";
import type { SubmissionListItem } from "@/lib/submissions/types";

const formatter = dateFormatter({
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
type PersonalProps = {
  rows: Promise<SubmissionListItem[]>;
  viewer: Viewer;
  now: Date;
};

async function Practice({ rows, viewer, now }: PersonalProps) {
  const practice = recentPractice(await rows, viewer, now);
  return (
    <HomePanel title="最近练习" href="/problems" className="order-1">
      {practice.length ? (
        <ul className="divide-y divide-border">
          {practice.map(({ row, ref }) => (
            <li
              key={`${row.contestSlug}/${row.problemSlug}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/50"
            >
              <div className="min-w-0">
                <Link
                  href={problemHref(row.contestSlug, row.problemSlug)}
                  className="text-sm font-medium break-words hover:text-primary"
                >
                  {ref.problem.title}
                </Link>
                <p className="text-fg-muted mt-1 text-xs">
                  {ref.contest.title} ·{" "}
                  {formatter.format(new Date(row.createdAt))}
                </p>
              </div>
              <Link
                href={problemHref(row.contestSlug, row.problemSlug)}
                aria-label={`打开${ref.problem.title}`}
                className="shrink-0 rounded-md bg-primary-subtle px-2.5 py-1.5 text-xs text-primary hover:bg-primary/15"
              >
                打开 →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted px-4 py-5 text-sm">
          还没有练习记录。
          <Link href="/problems" className="text-primary ml-2">
            浏览题库 →
          </Link>
        </p>
      )}
    </HomePanel>
  );
}

async function Submissions({ rows, viewer, now }: PersonalProps) {
  const latest = (await rows).slice(0, 5);
  const positions = await locateInQueues(
    latest.filter((row) => !isSettled(row.state)).map((row) => row.id),
  );
  return (
    <HomePanel title="近期提交" href="/submissions" className="order-3">
      {latest.length ? (
        <ul className="divide-y divide-border">
          {latest.map((row) => {
            const readable = problemFor(
              row.contestSlug,
              row.problemSlug,
              viewer,
              now,
            );
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-surface-2/50"
              >
                <div className="min-w-0 flex-1 basis-36 text-sm font-medium break-words">
                  {readable ? (
                    <Link
                      href={problemHref(row.contestSlug, row.problemSlug)}
                      className="hover:text-primary"
                    >
                      {readable.ref.problem.title}
                    </Link>
                  ) : (
                    <span>{row.problemTitle}</span>
                  )}
                </div>
                <span className="flex flex-wrap items-center gap-1.5">
                  <VerdictBadge submission={row} />
                  <QueueBadge queue={positions.get(row.id)} />
                </span>
                <time
                  dateTime={row.createdAt}
                  className="text-fg-muted text-xs tabular-nums"
                >
                  {formatter.format(new Date(row.createdAt))}
                </time>
                <Link
                  href={`/submissions/${row.id}`}
                  aria-label={`查看${row.problemTitle}的提交详情`}
                  className="text-primary text-xs"
                >
                  详情
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-fg-muted px-4 py-3 text-sm">还没有提交记录。</p>
      )}
    </HomePanel>
  );
}

function Schedule({ viewer, now }: { viewer: Viewer; now: Date }) {
  const contests = recentContests(contestsFor(viewer, now), now);
  return (
    <HomePanel title="近期比赛" href="/contests" className="order-2">
      <ul className="divide-y divide-border">
        {contests.map(({ config, preview }) => {
          const status = contestStatus(config, now);
          return (
            <li key={config.slug} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={status.tone}>{status.label}</Badge>
                {preview && <Badge tone="warn">未公开</Badge>}
              </div>
              <Link
                href={contestHref(config.slug)}
                className="block text-sm font-medium break-words hover:text-primary"
              >
                {config.title}
              </Link>
              <p className="text-fg-muted text-xs">
                {formatter.format(config.startsAt)} 开赛
              </p>
            </li>
          );
        })}
      </ul>
      {!contests.length && (
        <p className="text-fg-muted p-4 text-sm">暂无比赛。</p>
      )}
    </HomePanel>
  );
}

function Domains({ viewer, now }: { viewer: Viewer; now: Date }) {
  const groups = new Map<
    string,
    NonNullable<ReturnType<typeof contestFor>>[]
  >();
  for (const slug of catalogueSlugs()) {
    const contest = contestFor(slug, viewer, now);
    if (!contest) continue;
    const domain = contest.config.domain ?? "";
    const entries = groups.get(domain) ?? [];
    entries.push(contest);
    groups.set(domain, entries);
  }
  const ungrouped = groups.get("");
  if (ungrouped) {
    groups.delete("");
    groups.set("", ungrouped);
  }
  return (
    <HomePanel title="题库分区" href="/problems" className="order-5">
      <div className="divide-y divide-border">
        {[...groups].map(([domain, contests]) => (
          <div key={domain} className="px-4 py-3">
            <h3 className="text-fg-muted mb-2 text-xs font-medium">
              {domain || "其他分区"}
            </h3>
            <div className="flex flex-wrap gap-2">
              {contests.map(({ config, preview }) => (
                <Link
                  key={config.slug}
                  href={contestHref(config.slug)}
                  className="rounded-md border border-border bg-surface-2/30 px-2.5 py-1.5 text-xs hover:border-primary/40 hover:text-primary"
                >
                  {config.title}
                  {preview ? " · 未公开" : ""}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!groups.size && (
        <p className="text-fg-muted p-4 text-sm">题库还没有分区。</p>
      )}
    </HomePanel>
  );
}

function Announcements({ now }: { now: Date }) {
  const entries = publishedAnnouncements(undefined, now).slice(0, 3);
  if (!entries.length) return null;
  return (
    <HomePanel title="公告" href="/announcements" className="order-4">
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.slug} className="space-y-2 px-4 py-3">
            <Link
              href={`/announcements/${entry.slug}`}
              className="text-sm font-medium break-words hover:text-primary"
            >
              {entry.pinned && (
                <Badge tone="primary" className="mr-2">
                  置顶
                </Badge>
              )}
              {entry.title}
            </Link>
            <p className="text-fg-muted line-clamp-2 text-xs leading-5">
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
    </HomePanel>
  );
}

export async function HomeView() {
  const viewer = await getViewer();
  const now = new Date();
  const rows = homeSubmissions(viewer);
  const Board = siteViews.HomeLeaderboard;
  return (
    <div className="space-y-4">
      <HomeHero />
      <nav
        aria-label="快捷入口"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-sm"
      >
        {(site.homeEntries ?? []).map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="text-fg-muted hover:text-primary"
          >
            {entry.title} <span aria-hidden="true">↗</span>
          </Link>
        ))}
        {viewer.uid === null && (
          <Link href="/login?next=/" className="text-primary ml-auto text-xs">
            登录，查看我的练习 →
          </Link>
        )}
      </nav>
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
        <div className="contents lg:block lg:min-w-0 lg:space-y-5">
          {viewer.uid !== null && (
            <Suspense
              fallback={
                <HomePanelSkeleton title="最近练习" className="order-1" />
              }
            >
              <Practice rows={rows} viewer={viewer} now={now} />
            </Suspense>
          )}
          {viewer.uid !== null && (
            <Suspense
              fallback={
                <HomePanelSkeleton title="近期提交" className="order-3" />
              }
            >
              <Submissions rows={rows} viewer={viewer} now={now} />
            </Suspense>
          )}
          <Domains viewer={viewer} now={now} />
        </div>
        <div className="contents lg:block lg:min-w-0 lg:space-y-5">
          <Schedule viewer={viewer} now={now} />
          <Announcements now={now} />
          {viewer.uid !== null &&
            Board &&
            allows("leaderboard.read", null, viewer) && (
              <div className="order-6">
                <Suspense fallback={<HomePanelSkeleton title="排行榜" />}>
                  <Board />
                </Suspense>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

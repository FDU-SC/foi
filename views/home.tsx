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
import { problemFor, problemsFor, type ProblemView } from "@/lib/problems/access";
import { progressFor } from "@/lib/problems/progress";
import { summarizeProgress } from "@/lib/problems/selection";
import { dateFormatter } from "@/lib/format";
import { publishedAnnouncements } from "@/lib/announcements";
import { homeSubmissions, recentPractice, recentContests } from "@/lib/home";
import type { SubmissionListItem } from "@/lib/submissions/types";

const formatter = dateFormatter({
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const ROW = "border-border flex items-center gap-4 border-b py-2.5";
const EMPTY = "text-fg-muted py-4 text-sm";
const TITLE_LINK = "underline-offset-2 hover:underline";

type PersonalProps = {
  rows: Promise<SubmissionListItem[]>;
  viewer: Viewer;
  now: Date;
};
type Progress = Awaited<ReturnType<typeof progressFor>>;

async function Practice({ rows, viewer, now }: PersonalProps) {
  const practice = recentPractice(await rows, viewer, now);
  return (
    <HomePanel title="最近练习" href="/problems" className="order-1">
      {practice.length ? (
        <ul>
          {practice.map(({ row, ref }) => (
            <li key={`${row.contestSlug}/${row.problemSlug}`} className={ROW}>
              <div className="min-w-0 flex-1">
                <Link
                  href={problemHref(row.contestSlug, row.problemSlug)}
                  className={`text-[15px] font-semibold break-words ${TITLE_LINK}`}
                >
                  {ref.problem.title}
                </Link>
                <p className="text-fg-muted mt-0.5 text-xs">
                  {ref.contest.title}　{formatter.format(new Date(row.createdAt))}
                </p>
              </div>
              <VerdictBadge submission={row} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={EMPTY}>还没有练习记录。</p>
      )}
    </HomePanel>
  );
}

async function Submissions({ rows, viewer, now }: PersonalProps) {
  const latest = (await rows).slice(0, 5);
  return (
    <HomePanel title="近期提交" href="/submissions" className="order-3">
      {latest.length ? (
        <ul>
          {latest.map((row) => {
            const readable = problemFor(
              row.contestSlug,
              row.problemSlug,
              viewer,
              now,
            );
            return (
              <li key={row.id} className={`${ROW} flex-wrap gap-y-1`}>
                <time
                  dateTime={row.createdAt}
                  className="text-fg-muted w-24 shrink-0 font-mono text-xs tabular-nums"
                >
                  {formatter.format(new Date(row.createdAt))}
                </time>
                <div className="min-w-0 flex-1 basis-32 text-sm break-words">
                  {readable ? (
                    <Link
                      href={problemHref(row.contestSlug, row.problemSlug)}
                      className={TITLE_LINK}
                    >
                      {readable.ref.problem.title}
                    </Link>
                  ) : (
                    <span>{row.problemTitle}</span>
                  )}
                </div>
                <span className="flex items-center gap-2">
                  <VerdictBadge submission={row} />
                  <QueueBadge queue={row.queue} />
                </span>
                <Link
                  href={`/submissions/${row.id}`}
                  aria-label={`查看${row.problemTitle}的提交详情`}
                  className="text-fg-muted hover:text-fg text-xs transition-colors"
                >
                  详情
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={EMPTY}>还没有提交记录。</p>
      )}
    </HomePanel>
  );
}

function Schedule({ viewer, now }: { viewer: Viewer; now: Date }) {
  const contests = recentContests(contestsFor(viewer, now), now);
  return (
    <HomePanel title="近期比赛" href="/contests" className="order-2">
      <ul>
        {contests.map(({ config, preview }) => {
          const status = contestStatus(config, now);
          return (
            <li key={config.slug} className={ROW}>
              <div className="min-w-0 flex-1">
                <Link
                  href={contestHref(config.slug)}
                  className={`text-sm font-semibold break-words ${TITLE_LINK}`}
                >
                  {config.title}
                </Link>
                <p className="text-fg-muted mt-0.5 text-xs tabular-nums">
                  {formatter.format(config.startsAt)} 开赛
                </p>
              </div>
              <span className="flex shrink-0 flex-wrap justify-end gap-2">
                {preview && <Badge tone="warn">未公开</Badge>}
                <Badge tone={status.tone}>{status.label}</Badge>
              </span>
            </li>
          );
        })}
      </ul>
      {!contests.length && <p className={EMPTY}>暂无比赛。</p>}
    </HomePanel>
  );
}

/** Solved out of total, once the viewer's progress arrives. */
async function SolvedCount({
  problems,
  progress,
}: {
  problems: ProblemView[];
  progress: Promise<Progress>;
}) {
  const { solved } = summarizeProgress(problems, await progress);
  return solved === null ? problems.length : `${solved}/${problems.length}`;
}

function Domains({
  viewer,
  now,
  progress,
}: {
  viewer: Viewer;
  now: Date;
  progress: Promise<Progress> | null;
}) {
  const groups = new Map<
    string,
    (NonNullable<ReturnType<typeof contestFor>> & { problems: ProblemView[] })[]
  >();
  for (const slug of catalogueSlugs()) {
    const contest = contestFor(slug, viewer, now);
    if (!contest) continue;
    const domain = contest.config.domain ?? "";
    const entries = groups.get(domain) ?? [];
    entries.push({ ...contest, problems: problemsFor(slug, viewer, now) });
    groups.set(domain, entries);
  }
  const ungrouped = groups.get("");
  if (ungrouped) {
    groups.delete("");
    groups.set("", ungrouped);
  }
  return (
    <HomePanel title="题库分区" href="/problems" className="order-5">
      {[...groups].map(([domain, contests]) => (
        <div key={domain} className="mt-3">
          <h3 className="text-fg-muted mb-0.5 text-xs">{domain || "其他分区"}</h3>
          <ul>
            {contests.map(({ config, preview, problems }) => (
              <li key={config.slug}>
                <Link
                  href={contestHref(config.slug)}
                  className={`group flex items-baseline py-1 text-sm ${problems.length ? "text-fg" : "text-fg-subtle"}`}
                >
                  <span className="underline-offset-2 group-hover:underline">
                    {config.title}
                    {preview ? " · 未公开" : ""}
                  </span>
                  <span
                    aria-hidden
                    className="border-border-strong mx-2 flex-1 -translate-y-1 border-b border-dotted"
                  />
                  <span className="text-fg-muted font-mono text-xs tabular-nums">
                    {progress ? (
                      <Suspense fallback={problems.length}>
                        <SolvedCount problems={problems} progress={progress} />
                      </Suspense>
                    ) : (
                      problems.length
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!groups.size && <p className={EMPTY}>题库还没有分区。</p>}
    </HomePanel>
  );
}

function Announcements({ now }: { now: Date }) {
  const entries = publishedAnnouncements(undefined, now).slice(0, 3);
  if (!entries.length) return null;
  return (
    <HomePanel title="公告" href="/announcements" className="order-4">
      <ul>
        {entries.map((entry) => (
          <li key={entry.slug} className="border-border space-y-1 border-b py-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              {entry.pinned && <Badge tone="primary">置顶</Badge>}
              <Link
                href={`/announcements/${entry.slug}`}
                className={`text-sm font-semibold break-words ${TITLE_LINK}`}
              >
                {entry.title}
              </Link>
            </div>
            <p className="text-fg-muted line-clamp-2 text-xs leading-5">
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
    </HomePanel>
  );
}

export async function HomeView() {
  const viewer = await getViewer();
  const now = new Date();
  const rows = homeSubmissions(viewer);
  const slugs = catalogueSlugs();
  const progress = viewer.uid !== null && slugs.length > 0
    ? progressFor(slugs, viewer, now)
    : null;
  const entries = site.homeEntries ?? [];
  const Board = siteViews.HomeLeaderboard;
  return (
    <div className="space-y-6">
      <HomeHero />
      {entries.length > 0 && (
        <nav
          aria-label="快捷入口"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
        >
          {entries.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="text-fg-muted hover:text-fg underline-offset-2 transition-colors hover:underline"
            >
              {entry.title}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-9 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-14">
        <div className="contents lg:block lg:min-w-0 lg:space-y-9">
          {viewer.uid !== null && (
            <Suspense
              fallback={
                <HomePanelSkeleton title="最近练习" className="order-1" />
              }
            >
              <Practice rows={rows} viewer={viewer} now={now} />
            </Suspense>
          )}
          <Schedule viewer={viewer} now={now} />
          {viewer.uid !== null && (
            <Suspense
              fallback={
                <HomePanelSkeleton title="近期提交" className="order-3" />
              }
            >
              <Submissions rows={rows} viewer={viewer} now={now} />
            </Suspense>
          )}
          <Announcements now={now} />
        </div>
        <div className="contents lg:block lg:min-w-0 lg:space-y-9">
          <Domains viewer={viewer} now={now} progress={progress} />
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

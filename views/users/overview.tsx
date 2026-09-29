import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityHeatmap } from "@/components/profile/activity-heatmap";
import { profileHref } from "@/lib/accounts/profile";
import { dayStart } from "@/lib/calendar-day";
import { contestHref, problemHref } from "@/lib/contests/catalogue";
import { directionsOf } from "@/lib/contests/scope";
import { dateFormatter } from "@/lib/format";
import type { PairActivity, ProfileActivity, SectionProgress } from "@/lib/profile/activity";
import type { ContestRecord } from "@/lib/profile/ranks";
import {
  submissionsIn,
  timelineOf,
  type ActivityWindow,
  type MonthActivity,
} from "@/lib/profile/timeline";
import { cn } from "@/lib/utils";

const monthLabel = dateFormatter({ year: "numeric", month: "long" });
const shortDay = dateFormatter({ month: "short", day: "numeric" });

/** Rows a month lists per kind before folding the rest into a count. */
const MONTH_ROWS = 6;

/** Months shown before the rest fold away. */
const OPEN_MONTHS = 3;

const LINK = "text-fg underline-offset-2 hover:underline";

function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="border-fg mb-3 flex items-baseline justify-between gap-3 border-b pb-1.5">
      <h2 className="text-fg text-sm font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

function Directions({ sections }: { sections: SectionProgress[] }) {
  const directions = directionsOf(sections.map((section) => ({
    ...section,
    slug: section.contest.slug,
    domain: section.contest.domain,
  })));
  return (
    <section>
      <Heading>题库进度</Heading>
      <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {directions.map(({ heading, contests }) => {
          const solved = contests.reduce((sum, { solved }) => sum + solved, 0);
          const total = contests.every(({ total }) => total !== null)
            ? contests.reduce((sum, { total }) => sum + (total ?? 0), 0)
            : null;
          return (
            <div key={heading ?? ""} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                <h3 className="truncate">{heading ?? "其他分区"}</h3>
                <span className="text-fg-muted shrink-0 font-mono text-xs font-normal tabular-nums">
                  {total === null ? `通过 ${solved}` : `${solved}/${total}`}
                </span>
              </div>
              <ul className="mt-1 text-sm">
                {contests.map(({ contest, solved, total }) => (
                  <li key={contest.slug}>
                    <Link href={contestHref(contest.slug)} className="group flex items-baseline py-0.5">
                      <span className="text-fg-muted group-hover:text-fg min-w-0 truncate underline-offset-2 group-hover:underline">
                        {contest.title}
                      </span>
                      <span
                        aria-hidden
                        className="border-border-strong mx-2 flex-1 -translate-y-1 border-b border-dotted"
                      />
                      <span
                        className={cn(
                          "shrink-0 font-mono text-xs tabular-nums",
                          total !== null && solved === total ? "text-ok" : "text-fg-muted",
                        )}
                      >
                        {total === null ? solved : `${solved}/${total}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Calendar({
  days,
  window,
  years,
  username,
}: {
  days: ReadonlyMap<string, number>;
  window: ActivityWindow;
  years: number[];
  username: string;
}) {
  const total = submissionsIn(days, window);
  const selected = window.year ?? years[0];
  return (
    <section>
      <Heading
        aside={years.length > 1 ? (
          <nav aria-label="年份" className="flex flex-wrap gap-x-3 gap-y-1">
            {years.map((year) => (
              <Link
                key={year}
                href={`${profileHref(username)}?year=${year}`}
                aria-current={year === selected ? "page" : undefined}
                className={cn(
                  "text-xs tabular-nums transition-colors",
                  year === selected
                    ? "text-fg decoration-fg font-semibold underline decoration-2 underline-offset-4"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {year}
              </Link>
            ))}
          </nav>
        ) : undefined}
      >
        {window.year === null ? "过去一年" : `${window.year} 年`}提交{" "}
        <span className="tabular-nums">{total}</span> 次
      </Heading>
      <ActivityHeatmap days={days} window={window} />
    </section>
  );
}

function Event({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative">
      <span className="bg-fg-subtle absolute top-2 -left-[1.45rem] size-1.5 rounded-full" />
      <p className="text-fg text-sm">{title}</p>
      {children ? <ul className="mt-1.5 space-y-1">{children}</ul> : null}
    </li>
  );
}

function PairRow({ pair, children }: { pair: PairActivity; children: ReactNode }) {
  const { contest, problem } = pair.ref;
  return (
    <li className="flex items-center gap-3 text-xs">
      <Link
        href={problemHref(contest.slug, problem.slug)}
        className={cn(LINK, "min-w-0 truncate font-medium")}
      >
        {problem.title}
      </Link>
      <span className="text-fg-subtle hidden min-w-0 truncate sm:inline">{contest.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">{children}</span>
    </li>
  );
}

function More({ count }: { count: number }) {
  return count > 0 ? <li className="text-fg-subtle text-xs">还有 {count} 道题</li> : null;
}

function Month({ entry, records }: { entry: MonthActivity; records: ReadonlyMap<string, ContestRecord> }) {
  const most = entry.tried[0]?.count ?? 1;
  return (
    <div>
      <h3 className="text-fg-muted text-xs font-semibold">
        {monthLabel.format(dayStart(`${entry.month}-01`))}
      </h3>
      <ol className="border-border mt-2 mb-5 ml-1 space-y-3 border-l pl-5">
        {entry.solved.length > 0 ? (
          <Event title={<>通过了 <strong>{entry.solved.length}</strong> 道题</>}>
            {entry.solved.slice(0, MONTH_ROWS).map((pair) => (
              <PairRow key={`${pair.ref.contest.slug}/${pair.ref.problem.slug}`} pair={pair}>
                <time className="text-fg-subtle tabular-nums" dateTime={pair.solvedAt!.toISOString()}>
                  {shortDay.format(pair.solvedAt!)}
                </time>
              </PairRow>
            ))}
            <More count={entry.solved.length - MONTH_ROWS} />
          </Event>
        ) : null}
        <Event
          title={<>在 <strong>{entry.tried.length}</strong> 道题上提交了 <strong>{entry.submissions}</strong> 次</>}
        >
          {entry.tried.slice(0, MONTH_ROWS).map(({ pair, count }) => (
            <PairRow key={`${pair.ref.contest.slug}/${pair.ref.problem.slug}`} pair={pair}>
              <span className="bg-surface-2 hidden h-1 w-20 overflow-hidden sm:block">
                <span className="bg-fg/40 block h-full" style={{ width: `${(count / most) * 100}%` }} />
              </span>
              <span className="text-fg-muted w-8 text-right tabular-nums">{count}</span>
            </PairRow>
          ))}
          <More count={entry.tried.length - MONTH_ROWS} />
        </Event>
        {entry.entered.map((contest) => {
          const record = records.get(contest.slug);
          return (
            <Event
              key={contest.slug}
              title={
                <>
                  参加了{" "}
                  <Link href={contestHref(contest.slug)} className={cn(LINK, "font-medium")}>
                    {contest.title}
                  </Link>
                  {record ? (
                    <span className="text-fg-muted">
                      {" "}· 第 <strong className="text-fg tabular-nums">{record.row.rank}</strong> 名 / {record.entrants}
                    </span>
                  ) : null}
                </>
              }
            />
          );
        })}
      </ol>
    </div>
  );
}

function Timeline({
  activity,
  records,
  window,
}: {
  activity: ProfileActivity;
  records: ContestRecord[];
  window: ActivityWindow;
}) {
  const months = timelineOf(activity.pairs, window);
  const byContest = new Map(records.map((record) => [record.contest.slug, record]));
  return (
    <section>
      <Heading>活动记录</Heading>
      {months.length === 0 ? (
        <p className="text-fg-muted py-4 text-sm">这段时间没有提交记录。</p>
      ) : (
        <>
          {months.slice(0, OPEN_MONTHS).map((entry) => (
            <Month key={entry.month} entry={entry} records={byContest} />
          ))}
          {months.length > OPEN_MONTHS ? (
            <details className="group">
              <summary className="text-fg-muted hover:text-fg w-fit cursor-pointer list-none text-xs underline underline-offset-2 transition-colors group-open:mb-4">
                <span className="group-open:hidden">显示更早的 {months.length - OPEN_MONTHS} 个月</span>
                <span className="hidden group-open:inline">收起更早的记录</span>
              </summary>
              {months.slice(OPEN_MONTHS).map((entry) => (
                <Month key={entry.month} entry={entry} records={byContest} />
              ))}
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ProfileOverview({
  activity,
  records,
  window,
  years,
  username,
}: {
  activity: ProfileActivity;
  records: ContestRecord[];
  window: ActivityWindow;
  years: number[];
  username: string;
}) {
  return (
    <div className="space-y-9">
      {activity.sections.length > 0 ? <Directions sections={activity.sections} /> : null}
      <Calendar days={activity.days} window={window} years={years} username={username} />
      <Timeline activity={activity} records={records} window={window} />
    </div>
  );
}

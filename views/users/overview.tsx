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

function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-fg text-base">{children}</h2>
      {aside}
    </div>
  );
}

function Bar({ solved, total }: { solved: number; total: number }) {
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={solved}
      className="bg-surface-2 block h-1.5 overflow-hidden rounded-full"
    >
      <span
        className="bg-primary block h-full rounded-full"
        style={{ width: `${total ? (solved / total) * 100 : 0}%` }}
      />
    </span>
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {directions.map(({ heading, contests }) => {
          const solved = contests.reduce((sum, { solved }) => sum + solved, 0);
          const total = contests.every(({ total }) => total !== null)
            ? contests.reduce((sum, { total }) => sum + (total ?? 0), 0)
            : null;
          return (
            <article key={heading ?? ""} className="bg-surface border-border space-y-2 rounded-md border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-primary truncate text-sm font-semibold">{heading ?? "其他分区"}</h3>
                <span className="text-fg-muted shrink-0 font-mono text-xs tabular-nums">
                  {total === null ? `通过 ${solved}` : `${solved}/${total}`}
                </span>
              </div>
              {total === null ? null : <Bar solved={solved} total={total} />}
              <ul className="space-y-1 text-xs">
                {contests.map(({ contest, solved, total }) => (
                  <li key={contest.slug} className="flex items-center gap-2">
                    <Link
                      href={contestHref(contest.slug)}
                      className="text-fg-muted hover:text-primary min-w-0 flex-1 truncate"
                    >
                      {contest.title}
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 font-mono tabular-nums",
                        total !== null && solved === total ? "text-ok" : "text-fg-subtle",
                      )}
                    >
                      {total === null ? solved : `${solved}/${total}`}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
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
      <Heading>
        {window.year === null ? "过去一年" : `${window.year} 年`}提交{" "}
        <span className="font-mono">{total}</span> 次
      </Heading>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="bg-surface border-border min-w-0 flex-1 rounded-md border p-3">
          <ActivityHeatmap days={days} window={window} />
        </div>
        {years.length > 1 ? (
          <nav aria-label="年份" className="flex flex-wrap gap-1 lg:w-16 lg:flex-col">
            {years.map((year) => (
              <Link
                key={year}
                href={`${profileHref(username)}?year=${year}`}
                aria-current={year === selected ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                  year === selected
                    ? "bg-primary text-primary-fg"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {year}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </section>
  );
}

function Event({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative">
      <span className="bg-border border-bg absolute top-1 -left-[1.6rem] size-3 rounded-full border-2" />
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
        className="text-primary min-w-0 truncate font-medium hover:underline"
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
      <h3 className="text-fg flex items-center gap-2 text-xs font-semibold">
        {monthLabel.format(dayStart(`${entry.month}-01`))}
        <span className="bg-border h-px flex-1" />
      </h3>
      <ol className="border-border mt-2 mb-4 ml-1.5 space-y-3 border-l pl-5">
        {entry.solved.length > 0 ? (
          <Event title={<>通过了 <strong>{entry.solved.length}</strong> 道题</>}>
            {entry.solved.slice(0, MONTH_ROWS).map((pair) => (
              <PairRow key={`${pair.ref.contest.slug}/${pair.ref.problem.slug}`} pair={pair}>
                <time className="text-fg-subtle" dateTime={pair.solvedAt!.toISOString()}>
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
              <span className="bg-surface-2 hidden h-1.5 w-20 overflow-hidden rounded-full sm:block">
                <span className="bg-primary/60 block h-full" style={{ width: `${(count / most) * 100}%` }} />
              </span>
              <span className="text-fg-muted w-8 text-right font-mono tabular-nums">{count}</span>
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
                  <Link href={contestHref(contest.slug)} className="text-primary font-medium hover:underline">
                    {contest.title}
                  </Link>
                  {record ? (
                    <span className="text-fg-muted">
                      {" "}· 第 <strong className="text-fg font-mono">{record.row.rank}</strong> 名 / {record.entrants}
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
        <p className="text-fg-muted border-border rounded-md border px-4 py-6 text-center text-sm">
          这段时间没有提交记录。
        </p>
      ) : (
        <>
          {months.slice(0, OPEN_MONTHS).map((entry) => (
            <Month key={entry.month} entry={entry} records={byContest} />
          ))}
          {months.length > OPEN_MONTHS ? (
            <details className="group">
              <summary className="border-border text-fg-muted hover:text-primary hover:bg-surface-2 cursor-pointer list-none rounded-md border py-1.5 text-center text-xs transition-colors group-open:mb-4">
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
    <div className="space-y-6">
      {activity.sections.length > 0 ? <Directions sections={activity.sections} /> : null}
      <Calendar days={activity.days} window={window} years={years} username={username} />
      <Timeline activity={activity} records={records} window={window} />
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { ProblemRef } from "@/components/problem/problem-ref";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { ClockIcon, SolvedIcon, TrophyIcon } from "@/components/profile/icons";
import { Badge } from "@/components/ui/badge";
import { TableFrame } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { profileHref } from "@/lib/accounts/profile";
import type { Viewer } from "@/lib/authz/viewer";
import {
  contestHref,
  leaderboardHref,
  problemHref,
  standingsHref,
} from "@/lib/contests/catalogue";
import { dateFormatter } from "@/lib/format";
import { activityFor, type PairActivity, type ProfileActivity } from "@/lib/profile/activity";
import {
  catalogueRanks,
  contestRecords,
  type CatalogueRank,
  type ContestRecord,
  type Placement,
} from "@/lib/profile/ranks";
import { activityWindow, activityYears } from "@/lib/profile/timeline";
import type { SubmissionListItem } from "@/lib/submissions/types";
import { submissionsFor } from "@/lib/submissions/access";
import { ProfileOverview } from "@/views/users/overview";

export type ProfileTab = "overview" | "problems" | "contests" | "submissions";

export function readProfileTab(value: string | undefined): ProfileTab {
  return value === "problems" || value === "contests" || value === "submissions" ? value : "overview";
}

export interface ProfileData {
  activity: ProfileActivity;
  records: ContestRecord[];
  ranks: CatalogueRank[];

  /** Their submissions this viewer may read, newest first. */
  recent: SubmissionListItem[];
}

export async function loadProfileData(
  uid: number,
  viewer: Viewer,
  now: Date,
): Promise<ProfileData> {
  const activity = await activityFor(uid, viewer, now);
  const [records, ranks, recent] = await Promise.all([
    contestRecords(uid, activity.contests, viewer, now),
    catalogueRanks(uid, viewer, now),
    submissionsFor(viewer, { uid, limit: 30 }),
  ]);
  return { activity, records, ranks, recent };
}

const day = dateFormatter({ dateStyle: "medium" });
const moment = dateFormatter({ dateStyle: "short", timeStyle: "short" });

/** The counts and places under the name, the way a code host lists followers. */
export async function ProfileFacts({ data }: { data: Promise<ProfileData> }) {
  const { activity, records, ranks } = await data;
  const total = ranks.find((rank) => rank.id === undefined);
  return (
    <div className="text-fg-muted space-y-1.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <SolvedIcon />
        <strong className="text-fg">{activity.solved}</strong> 通过
        <span aria-hidden>·</span>
        <strong className="text-fg">{activity.submissions}</strong> 提交
        <span aria-hidden>·</span>
        <strong className="text-fg">{records.length}</strong> 比赛
      </p>
      {total ? (
        <p className="flex items-center gap-1.5">
          <TrophyIcon />
          题库排名
          <Link href={leaderboardHref()} className="text-fg font-semibold hover:text-primary">
            #{total.row.rank}
          </Link>
          <span className="text-fg-subtle">/ {total.entrants}</span>
        </p>
      ) : null}
      {activity.lastAt ? (
        <p className="flex items-center gap-1.5">
          <ClockIcon />
          最近活跃于 {day.format(activity.lastAt)}
        </p>
      ) : null}
    </div>
  );
}

function Total({ board, row }: Placement) {
  const Render = board.renderers.Total;
  return Render ? <Render row={row} /> : (
    <span className="text-fg font-mono font-semibold tabular-nums">{Math.round(row.total)}</span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-fg-muted border-border rounded-md border px-4 py-6 text-center text-sm">
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-fg mb-2 text-base">{children}</h2>;
}

const STATE_LABEL = { solved: "已通过", attempted: "尝试过", untouched: "未尝试" } as const;

function Status({ pair }: { pair: PairActivity }) {
  const progress = pair.progress;
  if (progress?.verdict) {
    return <Badge tone={progress.verdict.tone} title={progress.verdict.label}>{progress.verdict.short}</Badge>;
  }
  return <span className="text-fg-subtle text-xs">{progress ? STATE_LABEL[progress.state] : "—"}</span>;
}

function ProblemsTab({ pairs }: { pairs: PairActivity[] }) {
  const solved = pairs
    .filter((pair) => pair.progress?.state === "solved")
    .toSorted((a, b) => (b.solvedAt?.getTime() ?? 0) - (a.solvedAt?.getTime() ?? 0));
  const others = pairs.filter((pair) => pair.progress?.state !== "solved");
  const table = (rows: PairActivity[], when: (pair: PairActivity) => Date | null, column: string) => (
    <TableFrame>
      <table>
        <thead>
          <tr>
            <th className="w-20">状态</th>
            <th>题目</th>
            <th className="hidden w-48 md:table-cell">所属</th>
            <th className="w-20 text-right">提交</th>
            <th className="w-32 text-right">{column}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pair) => {
            const { contest, problem } = pair.ref;
            const at = when(pair);
            return (
              <tr key={`${contest.slug}/${problem.slug}`}>
                <td><Status pair={pair} /></td>
                <td>
                  <Link className="row-link" href={problemHref(contest.slug, problem.slug)}>
                    {problem.title}
                  </Link>
                </td>
                <td className="hidden md:table-cell">
                  <Link href={contestHref(contest.slug)} className="text-fg-muted hover:text-primary text-xs">
                    {contest.title}
                  </Link>
                </td>
                <td className="text-fg-muted text-right font-mono text-xs tabular-nums">
                  {pair.submittedOn.length}
                </td>
                <td className="text-fg-subtle text-right text-xs tabular-nums">
                  {at ? day.format(at) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>已通过 · {solved.length}</SectionTitle>
        {solved.length ? table(solved, (pair) => pair.solvedAt, "通过于") : <Empty>还没有通过的题目。</Empty>}
      </section>
      {others.length ? (
        <section>
          <SectionTitle>尝试过 · {others.length}</SectionTitle>
          {table(others, (pair) => pair.lastAt, "最近提交")}
        </section>
      ) : null}
    </div>
  );
}

function Place({ row, entrants }: Placement) {
  return (
    <span className="text-fg-muted text-xs whitespace-nowrap">
      第 <strong className="text-fg font-mono">{row.rank}</strong> 名 / {entrants}
    </span>
  );
}

function ContestsTab({ records, ranks }: { records: ContestRecord[]; ranks: CatalogueRank[] }) {
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>比赛记录 · {records.length}</SectionTitle>
        {records.length === 0 ? (
          <Empty>还没有比赛记录。</Empty>
        ) : (
          <TableFrame>
            <table>
              <thead>
                <tr>
                  <th>比赛</th>
                  <th className="w-32">开始时间</th>
                  <th className="w-32 text-right">名次</th>
                  <th className="w-24 text-right">成绩</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.contest.slug}>
                    <td>
                      <Link className="row-link" href={contestHref(record.contest.slug)}>
                        {record.contest.title}
                      </Link>
                    </td>
                    <td className="text-fg-subtle text-xs tabular-nums">{day.format(record.contest.startsAt)}</td>
                    <td className="text-right">
                      <Link href={standingsHref(record.contest.slug)} className="hover:text-primary">
                        <Place {...record} />
                      </Link>
                    </td>
                    <td className="text-right text-xs">
                      <span className="text-fg-subtle mr-1.5">{record.board.standings.totalLabel}</span>
                      <Total {...record} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </section>
      {ranks.length > 0 ? (
        <section>
          <SectionTitle>题库排名</SectionTitle>
          <TableFrame>
            <table>
              <thead>
                <tr>
                  <th>排行榜</th>
                  <th className="w-32 text-right">名次</th>
                  <th className="w-24 text-right">成绩</th>
                </tr>
              </thead>
              <tbody>
                {ranks.map((rank) => (
                  <tr key={rank.id ?? ""}>
                    <td>
                      <Link className="row-link" href={leaderboardHref(rank.id)}>{rank.title}</Link>
                    </td>
                    <td className="text-right"><Place {...rank} /></td>
                    <td className="text-right text-xs">
                      <span className="text-fg-subtle mr-1.5">{rank.board.standings.totalLabel}</span>
                      <Total {...rank} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </section>
      ) : null}
    </div>
  );
}

function SubmissionsTab({ rows, own }: { rows: SubmissionListItem[]; own: boolean }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-fg text-base">最近 {rows.length} 次提交</h2>
        {own ? (
          <Link href="/submissions" className="text-fg-muted hover:text-primary text-xs">
            全部 <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
      <TableFrame>
        <table>
          <thead>
            <tr>
              <th className="w-36">时间</th>
              <th>题目</th>
              <th className="w-40">结果</th>
              <th className="w-16 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="text-fg-subtle font-mono text-xs whitespace-nowrap">
                  {moment.format(new Date(row.createdAt))}
                </td>
                <td>
                  <ProblemRef
                    contestSlug={row.contestSlug}
                    slug={row.problemSlug}
                    fallbackTitle={row.problemTitle}
                    className="text-fg font-medium"
                  />
                </td>
                <td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <VerdictBadge submission={row} />
                    <QueueBadge queue={row.queue} />
                  </span>
                </td>
                <td className="text-right">
                  <Link href={`/submissions/${row.id}`} className="text-fg-subtle hover:text-primary text-xs">
                    详情
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

/** The submissions tab exists only when the viewer may read some of them. */
function shownTab(tab: ProfileTab, { recent }: ProfileData): ProfileTab {
  return tab === "submissions" && recent.length === 0 ? "overview" : tab;
}

/** The links line up with the main column while the rule spans the page. */
export async function ProfileTabs({
  data,
  tab,
  username,
}: {
  data: Promise<ProfileData>;
  tab: ProfileTab;
  username: string;
}) {
  const loaded = await data;
  const current = shownTab(tab, loaded);
  const base = profileHref(username);
  return (
    <Tabs
      label="主页内容"
      className="lg:pl-[264px] xl:pl-[296px]"
      tabs={[
        { key: "overview", label: "概览", href: base, current: current === "overview" },
        { key: "problems", label: "题目", count: loaded.activity.pairs.length, href: `${base}?tab=problems`, current: current === "problems" },
        { key: "contests", label: "比赛", count: loaded.records.length, href: `${base}?tab=contests`, current: current === "contests" },
        ...(loaded.recent.length > 0
          ? [{ key: "submissions", label: "提交", href: `${base}?tab=submissions`, current: current === "submissions" }]
          : []),
      ]}
    />
  );
}

export async function ProfileMain({
  data,
  tab,
  year,
  username,
  joinedAt,
  own,
  now,
}: {
  data: Promise<ProfileData>;
  tab: ProfileTab;
  year: string | undefined;
  username: string;
  joinedAt: Date;
  own: boolean;
  now: Date;
}) {
  const loaded = await data;
  const { activity, records, ranks, recent } = loaded;
  const current = shownTab(tab, loaded);
  const years = activityYears(activity.days, joinedAt, now);
  const picked = year !== undefined && years.includes(Number(year)) ? Number(year) : null;

  return current === "overview" ? (
    <ProfileOverview
      activity={activity}
      records={records}
      window={activityWindow(now, picked)}
      years={years}
      username={username}
    />
  ) : current === "problems" ? (
    <ProblemsTab pairs={activity.pairs} />
  ) : current === "contests" ? (
    <ContestsTab records={records} ranks={ranks} />
  ) : (
    <SubmissionsTab rows={recent} own={own} />
  );
}

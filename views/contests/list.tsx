import Link from "next/link";
import { getViewer } from "@/auth";
import { PageHeader, EmptyState, TableFrame } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { ContestCountdown } from "@/components/contests/countdown";
import { contestsFor } from "@/lib/contests/access";
import {
  contestHref,
  isCatalogue,
  standingsHref,
} from "@/lib/contests/catalogue";
import {
  contestPhase,
  contestStatus,
  type ContestConfig,
} from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { rulesetFor } from "@/lib/standings/registry";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });
const filters = [
  { id: "all", label: "全部" },
  { id: "running", label: "进行中" },
  { id: "upcoming", label: "即将开始" },
  { id: "ended", label: "已结束" },
] as const;

function duration(contest: ContestConfig) {
  const minutes = Math.ceil(
    (contest.endsAt.getTime() - contest.startsAt.getTime()) / 60000,
  );
  const hours = Math.floor(minutes / 60);
  return [
    hours ? `${hours} 小时` : "",
    minutes % 60 ? `${minutes % 60} 分钟` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function ContestRow({
  contest,
  preview,
  now,
}: {
  contest: ContestConfig;
  preview: boolean;
  now: Date;
}) {
  const phase = contestPhase(contest, now);
  const status = contestStatus(contest, now);
  return (
    <tr data-phase={phase}>
      <td className="py-3">
        <Link
          href={contestHref(contest.slug)}
          className="row-link break-words"
        >
          {contest.title}
        </Link>
        {contest.description && (
          <p
            className="text-fg-muted mt-0.5 line-clamp-1 text-xs"
            title={contest.description}
          >
            {contest.description}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap tabular-nums">
        <span title={`结束于 ${formatter.format(contest.endsAt)}`}>
          {formatter.format(contest.startsAt)}
        </span>
      </td>
      <td className="hidden whitespace-nowrap md:table-cell">{duration(contest)}</td>
      <td className="text-fg-muted hidden md:table-cell">
        {rulesetFor(contest.leaderboards[0].ruleset.id)?.name ?? "自定义赛制"}
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {preview && <Badge tone="warn">未公开</Badge>}
        </div>
        {phase !== "ended" && (
          <p className="text-fg-muted mt-0.5 text-xs">
            {phase === "upcoming" ? "距离开始 " : "距离结束 "}
            <ContestCountdown
              key={`${contest.slug}-${phase}`}
              target={(phase === "upcoming"
                ? contest.startsAt
                : contest.endsAt
              ).getTime()}
              initialNow={now.getTime()}
              refreshAt={
                phase === "running" ? contest.freezeAt?.getTime() : undefined
              }
            />
          </p>
        )}
      </td>
      <td className="text-right">
        {phase !== "upcoming" && (
          <Link
            href={standingsHref(contest.slug)}
            className="text-fg decoration-border-strong hover:decoration-fg text-sm underline underline-offset-2"
          >
            排行榜
          </Link>
        )}
      </td>
    </tr>
  );
}

export async function ContestListView({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const now = new Date();
  const all = contestsFor(await getViewer(), now).filter(
    ({ config }) => !isCatalogue(config.slug),
  );
  const query = await searchParams;
  const selected = filters.find(({ id }) => id === query?.status)?.id ?? "all";
  const phaseOf = (contest: ContestConfig) => {
    const phase = contestPhase(contest, now);
    return phase === "frozen" ? "running" : phase;
  };
  const visible = all.filter(
    ({ config }) => selected === "all" || phaseOf(config) === selected,
  );
  const focus =
    visible.find(({ config }) => phaseOf(config) === "running") ??
    visible.find(({ config }) => phaseOf(config) === "upcoming");
  const ordered = focus
    ? [focus, ...visible.filter((item) => item !== focus)]
    : visible;
  return (
    <div className="space-y-5">
      <PageHeader title="比赛" />
      <Tabs
        label="比赛状态"
        tabs={filters.map(({ id, label }) => ({
          key: id,
          label,
          href: id === "all" ? "/contests" : `/contests?status=${id}`,
          current: selected === id,
          count:
            id === "all"
              ? all.length
              : all.filter(({ config }) => phaseOf(config) === id).length,
        }))}
      />
      {ordered.length > 0 && (
        <TableFrame>
          <table>
            <thead>
              <tr>
                <th>比赛</th>
                <th>开始</th>
                <th className="hidden md:table-cell">时长</th>
                <th className="hidden md:table-cell">赛制</th>
                <th>状态</th>
                <th>
                  <span className="sr-only">排行榜</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ config, preview }) => (
                <ContestRow
                  key={config.slug}
                  contest={config}
                  preview={preview}
                  now={now}
                />
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {visible.length === 0 && (
        <EmptyState>
          {all.length === 0 ? "还没有比赛。" : "暂无此状态的比赛。"}
        </EmptyState>
      )}
    </div>
  );
}

import Link from "next/link";
import { getViewer } from "@/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
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
const month = dateFormatter({ month: "short" });
const day = dateFormatter({ day: "2-digit" });
const year = dateFormatter({ year: "numeric" });
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
  featured = false,
}: {
  contest: ContestConfig;
  preview: boolean;
  now: Date;
  featured?: boolean;
}) {
  const phase = contestPhase(contest, now);
  const status = contestStatus(contest, now);
  return (
    <article
      className={`contest-event ${featured ? "contest-featured" : ""}`}
      data-phase={phase}
    >
      <div className="contest-date" aria-hidden="true">
        <span className="text-xs font-medium">
          {month.format(contest.startsAt)}
        </span>
        <span className="text-3xl leading-tight font-semibold tabular-nums">
          {
            day
              .formatToParts(contest.startsAt)
              .find((part) => part.type === "day")?.value
          }
        </span>
        <span className="text-fg-muted text-[11px]">
          {
            year
              .formatToParts(contest.startsAt)
              .find((part) => part.type === "year")?.value
          }
        </span>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {preview && <Badge tone="warn">未公开</Badge>}
          <span className="text-fg-muted text-xs">
            {rulesetFor(contest.leaderboards[0].ruleset.id)?.name ??
              "自定义赛制"}
          </span>
        </div>
        <h2
          className={`${featured ? "text-xl sm:text-2xl" : "text-base"} font-semibold break-words`}
        >
          <Link
            href={contestHref(contest.slug)}
            className="hover:text-primary transition-colors"
          >
            {contest.title}
          </Link>
        </h2>
        {contest.description && (
          <p
            className="text-fg-muted line-clamp-1 text-sm"
            title={contest.description}
          >
            {contest.description}
          </p>
        )}
        <details className="text-fg-muted text-xs">
          <summary className="w-fit cursor-pointer rounded-sm hover:text-fg">
            {formatter.format(contest.startsAt)} 开赛{" "}
            <span className="mx-1.5">·</span> {duration(contest)}
          </summary>
          <p className="mt-2">结束于 {formatter.format(contest.endsAt)}</p>
        </details>
      </div>
      <div className="contest-event-actions">
        {featured && (
          <div className="mb-3 space-y-1">
            <p className="text-fg-muted text-xs">
              {phase === "upcoming" ? "距离开始" : "距离结束"}
            </p>
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
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={contestHref(contest.slug)}
            className={`${featured ? "ui-primary bg-primary text-primary-fg hover:bg-primary-hover" : "border border-border bg-surface hover:border-primary/40 hover:text-primary"} inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-colors`}
          >
            查看比赛{" "}
            <span className="ml-2" aria-hidden="true">
              →
            </span>
          </Link>
          <Link
            href={standingsHref(contest.slug)}
            className="text-fg-muted hover:text-primary text-xs"
          >
            排行榜
          </Link>
        </div>
      </div>
    </article>
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
  const remaining = visible.filter((item) => item !== focus);
  return (
    <div className="space-y-5">
      <PageHeader title="比赛" />
      <nav
        aria-label="比赛状态"
        className="flex flex-wrap gap-1 border-b border-border pb-3"
      >
        {filters.map(({ id, label }) => (
          <Link
            key={id}
            href={id === "all" ? "/contests" : `/contests?status=${id}`}
            aria-current={selected === id ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${selected === id ? "bg-primary-subtle text-primary font-medium" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            {label}
            <span className="text-xs tabular-nums opacity-70">
              {id === "all"
                ? all.length
                : all.filter(({ config }) => phaseOf(config) === id).length}
            </span>
          </Link>
        ))}
      </nav>
      {focus && (
        <ContestRow
          contest={focus.config}
          preview={focus.preview}
          now={now}
          featured
        />
      )}
      {remaining.length > 0 && (
        <section className="ui-panel overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">
              {remaining.every(({ config }) => phaseOf(config) === "ended")
                ? "历届比赛"
                : "比赛赛程"}
            </h2>
            <span className="text-fg-muted text-xs">
              {remaining.length} 场比赛
            </span>
          </div>
          <div className="divide-y divide-border">
            {remaining.map(({ config, preview }) => (
              <ContestRow
                key={config.slug}
                contest={config}
                preview={preview}
                now={now}
              />
            ))}
          </div>
        </section>
      )}
      {visible.length === 0 && (
        <EmptyState>
          {all.length === 0 ? "还没有比赛。" : "暂无此状态的比赛。"}
        </EmptyState>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import {
  contestFor,
  isContestProblemSetVisibleTo,
} from "@/lib/contests/access";
import type { ContestConfig } from "@/lib/contests/types";
import { standingsFor } from "@/lib/standings/compute";
import { StandingsTable } from "./standings-table";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/contests/[slug]/standings">): Promise<Metadata> {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  return { title: view ? `${view.config.title} 排行榜` : "排行榜" };
}

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function UpcomingNotice({ contest }: { contest: ContestConfig }) {
  return (
    <div className="space-y-5">
      <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
        <Link href="/contests" className="hover:text-fg transition-colors">
          比赛
        </Link>
        <span>/</span>
        <Link
          href={`/contests/${contest.slug}`}
          className="hover:text-fg transition-colors"
        >
          {contest.title}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">排行榜</h1>
        <Badge tone="info">未开始</Badge>
      </div>

      <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
        比赛将于 {formatter.format(contest.startsAt)} 开始，届时这里会出现排行榜。
      </p>
    </div>
  );
}

export default async function StandingsPage({
  params,
}: PageProps<"/contests/[slug]/standings">) {
  const { slug } = await params;
  const viewer = await getViewer();

  const view = contestFor(slug, viewer);
  if (!view) notFound();

  const contest = view.config;

  if (!isContestProblemSetVisibleTo(contest, viewer)) {
    return <UpcomingNotice contest={contest} />;
  }

  const data = await standingsFor(contest.slug, viewer);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
        <Link href="/contests" className="hover:text-fg transition-colors">
          比赛
        </Link>
        <span>/</span>
        <Link
          href={`/contests/${contest.slug}`}
          className="hover:text-fg transition-colors"
        >
          {contest.title}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">排行榜</h1>
        <Badge>{data.ruleset.name}</Badge>
        {data.standings.frozen ? <Badge tone="warn">已封榜</Badge> : null}
        {data.freezeBypassed ? (
          <Badge tone="info">封榜中 · 你看到的是完整排名</Badge>
        ) : null}
        <span className="text-fg-subtle ml-auto text-xs">
          共 {data.standings.rows.length} 人
        </span>
      </div>

      <StandingsTable data={data} />
    </div>
  );
}

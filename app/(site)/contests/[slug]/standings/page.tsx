import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StandingsTable } from "@/components/standings/standings-table";
import { Badge } from "@/components/ui/badge";
import { getContestBySlug } from "@/lib/contests/queries";
import { getContestStandings } from "@/lib/standings/compute";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/contests/[slug]/standings">): Promise<Metadata> {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
  return { title: contest ? `${contest.title} 排行榜` : "排行榜" };
}

export default async function StandingsPage({
  params,
}: PageProps<"/contests/[slug]/standings">) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
  if (!contest) notFound();

  const data = await getContestStandings(contest.id);
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
        <span className="text-fg-subtle ml-auto text-xs">
          共 {data.standings.rows.length} 人
        </span>
      </div>

      <StandingsTable data={data} />
    </div>
  );
}

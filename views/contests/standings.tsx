import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { StandingsLiveRefresh } from "@/components/standings/live-refresh";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  contestFor,
  isContestProblemSetVisibleTo,
} from "@/lib/contests/access";
import {
  catalogueHref,
  contestHref,
  isCatalogue,
} from "@/lib/contests/catalogue";
import {
  contestPhase,
  type ContestConfig,
  type ContestPhase,
} from "@/lib/contests/types";
import { standingsFor } from "@/lib/standings/compute";
import { dateFormatter } from "@/lib/format";
import type { BoardProps } from "@/lib/standings/types";

function DefaultBoard({ board }: BoardProps) {
  if (board.standings.rows.length === 0) {
    return (
      <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
        还没有提交记录。
      </p>
    );
  }
  return (
    <ol className="divide-border divide-y">
      {board.standings.rows.map((row) => (
        <li key={row.participant.uid} className="flex items-center gap-3 px-3 py-2">
          <span className="text-fg-muted font-mono text-xs tabular-nums w-8 text-right">{row.rank}</span>
          <Avatar of={row.participant} />
          <span className="text-fg font-medium">{row.participant.nickname}</span>
          <span className="text-fg-muted ml-auto font-mono text-sm tabular-nums">{Math.round(row.total)}</span>
        </li>
      ))}
    </ol>
  );
}

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

/** Phases where new submissions can still change the board, so polling earns its keep. */
const MOVING_PHASES: ContestPhase[] = ["running", "frozen"];

async function titleOf(contestSlug: string): Promise<Metadata> {
  const view = contestFor(contestSlug, await getViewer());
  return { title: view ? `${view.config.title} 排行榜` : "排行榜" };
}

export async function standingsMetadata({
  params,
}: PageProps<"/contests/[slug]/standings">): Promise<Metadata> {
  const { slug } = await params;
  return titleOf(slug);
}

export async function catalogueStandingsMetadata({
  params,
}: PageProps<"/problems/[section]/standings">): Promise<Metadata> {
  const { section } = await params;
  return titleOf(section);
}

/** Where this board sits: under the catalogue index, or under `/contests`. */
function Crumbs({ contest }: { contest: ContestConfig }) {
  const catalogued = isCatalogue(contest.slug);

  return (
    <nav className="text-fg-subtle flex items-center gap-1.5 text-xs">
      <Link
        href={catalogued ? catalogueHref() : "/contests"}
        className="hover:text-fg transition-colors"
      >
        {catalogued ? "题库" : "比赛"}
      </Link>
      <span>/</span>
      <Link
        href={contestHref(contest.slug)}
        className="hover:text-fg transition-colors"
      >
        {contest.title}
      </Link>
    </nav>
  );
}

function UpcomingNotice({ contest }: { contest: ContestConfig }) {
  return (
    <div className="space-y-5">
      <Crumbs contest={contest} />

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

export async function StandingsView({
  params,
}: PageProps<"/contests/[slug]/standings">) {
  const { slug } = await params;
  return <Standings contestSlug={slug} />;
}

export async function CatalogueStandingsView({
  params,
}: PageProps<"/problems/[section]/standings">) {
  const { section } = await params;

  // Only a catalogued contest answers here; every other one keeps its board
  // under `/contests`, and a board must not hold two addresses either.
  if (!isCatalogue(section)) notFound();

  return <Standings contestSlug={section} />;
}

async function Standings({ contestSlug }: { contestSlug: string }) {
  const viewer = await getViewer();

  const view = contestFor(contestSlug, viewer);
  if (!view) notFound();

  const contest = view.config;

  if (!isContestProblemSetVisibleTo(contest, viewer)) {
    return <UpcomingNotice contest={contest} />;
  }

  const data = await standingsFor(contest.slug, viewer);
  if (!data) notFound();

  const totalRows = data.boards[0]?.standings.rows.length ?? 0;
  const phase = contestPhase(contest);

  return (
    <div className="space-y-5">
      <Crumbs contest={contest} />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">排行榜</h1>
        {data.frozen ? <Badge tone="warn">已封榜</Badge> : null}
        <span className="text-fg-subtle ml-auto text-xs">
          共 {totalRows} 人
        </span>
        <StandingsLiveRefresh defaultOn={MOVING_PHASES.includes(phase)} />
      </div>

      {data.boards.map((board) => (
        <section key={board.leaderboard.id} className="space-y-3">
          {data.boards.length > 1 ? (
            <div className="flex items-center gap-2">
              <h2 className="text-fg text-lg font-semibold">
                {board.leaderboard.title}
              </h2>
              <Badge>{board.ruleset.name}</Badge>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge>{board.ruleset.name}</Badge>
            </div>
          )}
          {(() => {
            const Board = board.renderers.Board ?? DefaultBoard;
            return <Board board={board} problems={data.problems} />;
          })()}
        </section>
      ))}
    </div>
  );
}

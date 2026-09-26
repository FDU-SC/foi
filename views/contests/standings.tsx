import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { StandingsLiveRefresh } from "@/components/standings/live-refresh";
import { StandingsPanel } from "@/components/standings/standings-panel";
import { Badge } from "@/components/ui/badge";
import { FilterChips } from "@/components/ui/filter-bar";
import {
  contestFor,
  isContestProblemSetVisibleTo,
} from "@/lib/contests/access";
import { standingsHref } from "@/lib/contests/catalogue";
import {
  contestPhase,
  type ContestConfig,
  type ContestPhase,
} from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { readOne } from "@/lib/query";
import { standingsFor } from "@/lib/standings/compute";
import { STANDINGS_PARAMS } from "@/lib/standings/selection";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

/** Phases where new submissions can still change the board, so polling earns its keep. */
const MOVING_PHASES: ContestPhase[] = ["running", "frozen"];

const FRAME = "min-w-0 space-y-5 p-4 sm:p-6";

export async function standingsMetadata({
  params,
}: PageProps<"/contests/[slug]/standings">): Promise<Metadata> {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  return { title: view ? `${view.config.title} 排行榜` : "排行榜" };
}

function UpcomingNotice({ contest }: { contest: ContestConfig }) {
  return (
    <div className={FRAME}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">排行榜</h1>
        <Badge tone="info">未开始</Badge>
      </div>

      <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
        比赛将于 {formatter.format(contest.startsAt)} 开始。
      </p>
    </div>
  );
}

/** A contest's own boards, inside its workspace. Catalogued sections rank on `/leaderboard`. */
export async function StandingsView({
  params,
  searchParams,
}: PageProps<"/contests/[slug]/standings">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const viewer = await getViewer();

  const view = contestFor(slug, viewer);
  if (!view) notFound();

  const contest = view.config;

  if (!isContestProblemSetVisibleTo(contest, viewer)) {
    return <UpcomingNotice contest={contest} />;
  }

  const data = await standingsFor(contest.slug, viewer);
  if (!data) notFound();

  // A contest may declare several boards; one is shown at a time.
  const [first] = data.boards;
  const asked = readOne(query, STANDINGS_PARAMS.board);
  const board = data.boards.find(({ leaderboard }) => leaderboard.id === asked) ?? first;

  return (
    <div className={FRAME}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">排行榜</h1>
        {data.frozen ? <Badge tone="warn">已封榜</Badge> : null}
        <span className="text-fg-subtle ml-auto text-xs">
          共 {board.standings.rows.length} 人
        </span>
        <StandingsLiveRefresh defaultOn={MOVING_PHASES.includes(contestPhase(contest))} />
      </div>

      {data.boards.length > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-fg-muted text-sm font-medium">榜单</span>
          <div className="flex flex-wrap gap-2">
            <FilterChips
              path={standingsHref(contest.slug)}
              params={query}
              row={{
                key: STANDINGS_PARAMS.board,
                label: "榜单",
                selected: [board.leaderboard.id],
                fallback: first.leaderboard.id,
                choices: data.boards.map(({ leaderboard }) => ({ value: leaderboard.id, label: leaderboard.title })),
              }}
            />
          </div>
        </div>
      ) : null}

      <StandingsPanel
        path={standingsHref(contest.slug)}
        query={query}
        board={board}
        problems={data.problems}
        viewerUid={viewer.uid}
      />
    </div>
  );
}

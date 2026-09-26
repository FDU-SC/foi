import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { StandingsPanel } from "@/components/standings/standings-panel";
import { Badge } from "@/components/ui/badge";
import type { FilterRow } from "@/components/ui/filter-bar";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueBoardSections,
  catalogueLeaderboards,
  leaderboardHref,
} from "@/lib/contests/catalogue";
import { queryString, readAll, readOne, type SearchParams } from "@/lib/query";
import { catalogueStandingsFor } from "@/lib/standings/compute";
import { STANDINGS_PARAMS } from "@/lib/standings/selection";

const SECTION = "section";
const PERIOD = "period";

/** The choice standing for an absent parameter: the total, or all time. */
const UNSET = "";

const PERIODS = [
  { value: "7d", label: "近 7 天", days: 7 },
  { value: "30d", label: "近 30 天", days: 30 },
] as const;

/**
 * The catalogue's leaderboard: the main boards of the catalogued sections,
 * computed as one and narrowed by direction, section and period.
 */
export async function LeaderboardView({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
} = {}) {
  const query = (await searchParams) ?? {};
  const board = query[STANDINGS_PARAMS.board];
  const boards = catalogueLeaderboards();
  if (board !== undefined && (
    typeof board !== "string" ||
    !boards.some((item) => item.id === board)
  )) notFound();

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(leaderboardHref() + queryString(query))}`);
  const viewer = viewerFor(user);
  if (!allows("leaderboard.read", null, viewer)) notFound();

  const offered = (catalogueBoardSections(board) ?? []).flatMap((slug) => {
    const view = contestFor(slug, viewer);
    return view ? [{ value: slug, label: view.config.title }] : [];
  });
  const sections = readAll(query, SECTION).filter((slug) => offered.some(({ value }) => value === slug));
  const period = PERIODS.find(({ value }) => value === readOne(query, PERIOD));

  const data = await catalogueStandingsFor(
    { board, sections, days: period?.days },
    viewer,
  );
  if (!data) notFound();

  const rows: FilterRow[] = [];
  if (boards.length > 0) {
    rows.push({
      key: STANDINGS_PARAMS.board,
      label: "方向",
      selected: [board ?? UNSET],
      fallback: UNSET,
      resets: [SECTION],
      choices: [{ value: UNSET, label: "总榜" }, ...boards.map(({ id, title }) => ({ value: id, label: title }))],
    });
  }
  if (offered.length > 1) {
    rows.push({ key: SECTION, label: "分区", multiple: true, selected: sections, choices: offered });
  }
  rows.push({
    key: PERIOD,
    label: "时间",
    selected: [period?.value ?? UNSET],
    fallback: UNSET,
    choices: [{ value: UNSET, label: "全部" }, ...PERIODS],
  });

  const title = boards.find(({ id }) => id === board)?.title;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-bold tracking-tight">
          {title ? `${title}排行榜` : "总排行榜"}
        </h1>
        <Badge title={data.board.ruleset.description}>{data.board.ruleset.name}</Badge>
        {data.frozen ? <Badge tone="warn">已封榜</Badge> : null}
        <span className="text-fg-subtle ml-auto text-sm">
          共 {data.board.standings.rows.length} 人
        </span>
      </div>

      <StandingsPanel
        path={leaderboardHref()}
        query={query}
        rows={rows}
        board={data.board}
        problems={data.problems}
        viewerUid={viewer.uid}
      />
    </div>
  );
}

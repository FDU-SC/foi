import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { StandingsPanel } from "@/components/standings/standings-panel";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { allows } from "@/lib/authz/engine";
import { viewerFor } from "@/lib/authz/viewer";
import { dayEnd, dayStart, readDay } from "@/lib/calendar-day";
import { contestFor } from "@/lib/contests/access";
import {
  catalogueBoardSections,
  catalogueLeaderboards,
  catalogueSlugs,
  leaderboardHref,
} from "@/lib/contests/catalogue";
import { PAGE_PARAM } from "@/lib/paging";
import { carried, queryString, readAll, readOne, without, type SearchParams } from "@/lib/query";
import { site } from "@/lib/site";
import { catalogueStandingsFor } from "@/lib/standings/compute";
import { STANDINGS_PARAMS } from "@/lib/standings/selection";

const BOARD = STANDINGS_PARAMS.board;
const SECTION = "section";
const FROM = "from";
const TO = "to";

/**
 * The catalogue's leaderboard panel body. Title and tabs live in the shared
 * shell; this is the date range and standings under them.
 */
export async function LeaderboardView({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
} = {}) {
  const asked = (await searchParams) ?? {};
  const board = asked[BOARD];
  const boards = catalogueLeaderboards();
  if (board !== undefined && (
    typeof board !== "string" ||
    !boards.some((item) => item.id === board)
  )) notFound();

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(leaderboardHref() + queryString(asked))}`);
  const viewer = viewerFor(user);
  if (!allows("leaderboard.read", null, viewer)) notFound();

  const contests = catalogueSlugs().flatMap((slug) => contestFor(slug, viewer)?.config ?? []);
  const spanned = catalogueBoardSections(board) ?? [];
  const sections = readAll(asked, SECTION).filter((slug) =>
    spanned.includes(slug) && contests.some((contest) => contest.slug === slug));

  // Days a visitor can only have typed are dropped, and a reversed pair reads as meant.
  const days = [readDay(readOne(asked, FROM)), readDay(readOne(asked, TO))];
  const [from, to] = days[0] && days[1] && days[0] > days[1] ? [days[1], days[0]] : days;
  const query = {
    ...without(asked, FROM, TO),
    ...(from ? { [FROM]: from } : {}),
    ...(to ? { [TO]: to } : {}),
  };

  const data = await catalogueStandingsFor(
    { board, sections, from: from ? dayStart(from) : undefined, until: to ? dayEnd(to) : undefined },
    viewer,
  );
  if (!data) notFound();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted text-sm font-medium">时间</span>
        <DateRangePicker
          action={leaderboardHref()}
          carried={carried(query, FROM, TO, PAGE_PARAM)}
          names={{ from: FROM, to: TO }}
          value={{ from, to }}
          label="时间"
          timeZone={site.timezone}
        />
        {data.frozen ? <Badge tone="warn">已封榜</Badge> : null}
        <span className="text-fg-subtle ml-auto text-sm">
          共 {data.board.standings.rows.length} 人
        </span>
      </div>

      <StandingsPanel
        path={leaderboardHref()}
        query={query}
        board={data.board}
        problems={data.problems}
        viewerUid={viewer.uid}
      />
    </div>
  );
}

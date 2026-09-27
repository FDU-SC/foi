import Link from "next/link";
import { ProfileLink } from "@/components/account/profile-link";
import { SearchForm } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { PAGE_PARAM } from "@/lib/paging";
import { queryString, withParam, without, type SearchParams } from "@/lib/query";
import type { LeaderboardStandings } from "@/lib/standings/compute";
import { selectStandings, STANDINGS_PARAMS } from "@/lib/standings/selection";
import type { BoardProps, ContestProblem, StandingsRow } from "@/lib/standings/types";

/**
 * One computed board with what every standings page shares: the viewer's own
 * place, a search over names right above the rows, and pages. What the board
 * covers is chosen above it by the page. The rows are drawn by the ruleset's
 * `Board`.
 */
export function StandingsPanel({
  path,
  query,
  board,
  problems,
  viewerUid,
}: {
  path: string;
  query: SearchParams;
  board: LeaderboardStandings;
  problems: ContestProblem[];
  viewerUid: number | null;
}) {
  const { standings, renderers } = board;
  const selection = selectStandings(standings.rows, query, viewerUid);
  const Board = renderers.Board ?? DefaultBoard;

  return (
    <div className="min-w-0 space-y-3">
      {viewerUid !== null ? (
        <MyPlace
          mine={selection.mine}
          board={board}
          href={(page) => path + withParam(without(query, STANDINGS_PARAMS.search), PAGE_PARAM, page === 1 ? undefined : String(page))}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SearchForm
          path={path}
          params={query}
          name={STANDINGS_PARAMS.search}
          value={selection.searchValue}
          placeholder="搜索用户"
        />
        {selection.filtered ? (
          <Link
            href={path + queryString(without(query, STANDINGS_PARAMS.search, PAGE_PARAM))}
            className="text-fg-muted hover:text-fg text-xs underline underline-offset-2"
          >
            清除搜索
          </Link>
        ) : null}
      </div>

      {selection.matched === 0 && selection.filtered ? (
        <p className="text-fg-muted border-border border-y py-10 text-center text-sm">
          没有符合条件的用户。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Board
            board={{ ...board, standings: { ...standings, rows: selection.rows } }}
            problems={problems}
            highlight={viewerUid}
          />
        </div>
      )}

      <Pagination path={path} params={query} page={selection.page} pages={selection.pages} />
    </div>
  );
}

function MyPlace({
  mine,
  board: { standings, renderers },
  href,
}: {
  mine: { row: StandingsRow<unknown>; page: number } | null;
  board: LeaderboardStandings;
  href: (page: number) => string;
}) {
  const Total = renderers.Total;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {mine ? (
        <>
          <span className="bg-mark inline-flex items-center gap-x-4 px-2 py-1">
            <span>
              我的排名 <span className="font-semibold tabular-nums">#{mine.row.rank}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              {standings.totalLabel}
              {Total ? <Total row={mine.row} /> : <span className="font-semibold tabular-nums">{Math.round(mine.row.total)}</span>}
            </span>
          </span>
          <Link href={href(mine.page)} className="text-fg-muted hover:text-fg text-xs underline underline-offset-2">
            查看所在位置
          </Link>
        </>
      ) : (
        <span className="text-fg-muted">
          我的排名 <span className="text-fg-subtle">暂无记录</span>
        </span>
      )}
    </div>
  );
}

function DefaultBoard({ board, highlight }: BoardProps) {
  if (board.standings.rows.length === 0) {
    return (
      <p className="text-fg-muted border-border border-y py-10 text-center text-sm">
        还没有提交记录。
      </p>
    );
  }
  return (
    <ol className="border-fg border-t">
      {board.standings.rows.map((row) => {
        const mine = row.participant.uid === highlight;
        return (
          <li
            key={row.participant.uid}
            aria-current={mine || undefined}
            className={`border-border flex items-center gap-3 border-b px-1 py-2 ${mine ? "bg-mark" : ""}`}
          >
            <span className="text-fg-muted w-8 text-right text-xs tabular-nums">
              {row.rank}
            </span>
            <ProfileLink username={row.participant.username} className="text-fg font-medium">
              {row.participant.nickname}
            </ProfileLink>
            <span className="ml-auto text-sm font-semibold tabular-nums">
              {Math.round(row.total)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

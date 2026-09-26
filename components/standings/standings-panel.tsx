import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { FilterBar, type FilterRow } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { PAGE_PARAM } from "@/lib/paging";
import { withParam, without, type SearchParams } from "@/lib/query";
import type { LeaderboardStandings } from "@/lib/standings/compute";
import { selectStandings, STANDINGS_PARAMS } from "@/lib/standings/selection";
import type { BoardProps, ContestProblem, StandingsRow } from "@/lib/standings/types";

/**
 * One computed board with the controls every standings page shares: the
 * viewer's own place, a search over names, the caller's filters, and pages.
 * The board itself is drawn by its ruleset's `Board`.
 */
export function StandingsPanel({
  path,
  query,
  rows: filters,
  board,
  problems,
  viewerUid,
}: {
  path: string;
  query: SearchParams;
  rows: FilterRow[];
  board: LeaderboardStandings;
  problems: ContestProblem[];
  viewerUid: number | null;
}) {
  const { standings, renderers } = board;
  const selection = selectStandings(standings.rows, query, viewerUid);
  const Board = renderers.Board ?? DefaultBoard;
  const narrowed = filters.some((row) => row.selected.some((value) => value !== row.fallback));

  return (
    <div className="min-w-0 space-y-3">
      {viewerUid !== null ? (
        <MyPlace
          mine={selection.mine}
          board={board}
          href={(page) => path + withParam(without(query, STANDINGS_PARAMS.search), PAGE_PARAM, page === 1 ? undefined : String(page))}
        />
      ) : null}

      <FilterBar
        path={path}
        params={query}
        rows={filters}
        searchKey={STANDINGS_PARAMS.search}
        searchValue={selection.searchValue}
        searchPlaceholder="搜索用户"
        filtered={selection.filtered || narrowed}
      />

      {selection.matched === 0 && selection.filtered ? (
        <p className="text-fg-subtle border-border rounded-lg border py-12 text-center text-sm">
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
    <div className="border-border bg-surface flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 text-sm">
      <span className="text-fg-muted">我的排名</span>
      {mine ? (
        <>
          <span className="text-fg font-mono text-lg font-semibold tabular-nums">#{mine.row.rank}</span>
          <span className="text-fg-muted inline-flex items-center gap-1.5">
            {standings.totalLabel}
            {Total ? <Total row={mine.row} /> : <span className="text-fg font-mono">{Math.round(mine.row.total)}</span>}
          </span>
          <Link href={href(mine.page)} className="text-primary ml-auto text-xs hover:underline">
            查看所在位置
          </Link>
        </>
      ) : (
        <span className="text-fg-subtle">暂无记录</span>
      )}
    </div>
  );
}

function DefaultBoard({ board, highlight }: BoardProps) {
  if (board.standings.rows.length === 0) {
    return (
      <p className="text-fg-subtle border-border rounded-lg border bg-surface py-10 text-center text-sm">
        还没有提交记录。
      </p>
    );
  }
  return (
    <ol className="divide-border divide-y">
      {board.standings.rows.map((row) => (
        <li
          key={row.participant.uid}
          aria-current={row.participant.uid === highlight || undefined}
          className="flex items-center gap-3 px-3 py-2"
        >
          <span className="text-fg-muted font-mono text-xs tabular-nums w-8 text-right">
            {row.rank}
          </span>
          <Avatar of={row.participant} />
          <span className="text-fg font-medium">
            {row.participant.nickname}
          </span>
          <span className="text-fg-muted ml-auto font-mono text-sm tabular-nums">
            {Math.round(row.total)}
          </span>
        </li>
      ))}
    </ol>
  );
}

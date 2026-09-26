import { PAGE_SIZE, paginate } from "@/lib/paging";
import { readOne, type SearchParams } from "@/lib/query";
import type { StandingsRow } from "./types";

/** The query parameters every standings page shares. */
export const STANDINGS_PARAMS = { search: "q", board: "board" } as const;

/**
 * Search and page ranked rows; performs no reads.
 *
 * Ranks are assigned before this runs, so a searched or paged row keeps the
 * place it holds on the whole board.
 */
export function selectStandings<Cell>(
  rows: StandingsRow<Cell>[],
  query: SearchParams,
  viewerUid: number | null,
) {
  const searchValue = readOne(query, STANDINGS_PARAMS.search) ?? "";
  const text = searchValue.trim().toLowerCase();
  const matched = text
    ? rows.filter(({ participant: { nickname, username } }) =>
      nickname.toLowerCase().includes(text) || username?.toLowerCase().includes(text))
    : rows;
  const { items, page, pages } = paginate(matched, query);

  const at = viewerUid === null ? -1 : rows.findIndex(({ participant }) => participant.uid === viewerUid);
  return {
    rows: items,
    page,
    pages,
    matched: matched.length,
    searchValue,
    filtered: text.length > 0,

    /** The viewer's row and the page of the unsearched board it sits on. */
    mine: at < 0 ? null : { row: rows[at], page: Math.floor(at / PAGE_SIZE) + 1 },
  };
}

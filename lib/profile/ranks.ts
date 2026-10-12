import "server-only";
import { allows } from "@/lib/authz/engine";
import type { Viewer } from "@/lib/authz/viewer";
import { catalogueLeaderboards } from "@/lib/contests/catalogue";
import type { ContestConfig } from "@/lib/contests/types";
import { catalogueStandingsFor, standingsFor, type LeaderboardStandings } from "@/lib/standings/compute";
import type { StandingsRow } from "@/lib/standings/types";

/** One person's row on a board, with what it takes to show its total. */
export interface Placement {
  row: StandingsRow<unknown>;
  entrants: number;
  board: LeaderboardStandings;
}

export interface ContestRecord extends Placement {
  contest: ContestConfig;
}

export interface CatalogueRank extends Placement {
  /** A `site.catalogueLeaderboards` id. Absent is the total. */
  id?: string;
  title: string;
}

function placementOn(uid: number, board: LeaderboardStandings): Placement | undefined {
  const { rows } = board.standings;
  const row = rows.find((one) => one.participant.uid === uid);
  return row ? { row, entrants: rows.length, board } : undefined;
}

/** Their row on each contest's main leaderboard, as this viewer may see it. */
export async function contestRecords(
  uid: number,
  contests: readonly ContestConfig[],
  viewer: Viewer,
  now = new Date(),
): Promise<ContestRecord[]> {
  const records = await Promise.all(contests.map(async (contest) => {
    const main = (await standingsFor(contest.slug, viewer, now))?.boards[0];
    const placement = main && placementOn(uid, main);
    return placement ? [{ contest, ...placement }] : [];
  }));
  return records.flat();
}

/** Their row on the catalogue's total and on each direction board. */
export async function catalogueRanks(
  uid: number,
  viewer: Viewer,
  now = new Date(),
): Promise<CatalogueRank[]> {
  if (!allows("leaderboard.read", null, viewer, { now })) return [];
  const boards = [
    { id: undefined, title: "总榜" },
    ...catalogueLeaderboards().map(({ id, title }) => ({ id, title })),
  ];
  const ranks = await Promise.all(boards.map(async ({ id, title }) => {
    const standings = await catalogueStandingsFor({ board: id }, viewer, now);
    const placement = standings && placementOn(uid, standings.board);
    return placement ? [{ id, title, ...placement }] : [];
  }));
  return ranks.flat();
}

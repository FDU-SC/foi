import { describe, expect, it } from "vitest";
import { PAGE_SIZE } from "@/lib/paging";
import { selectStandings } from "./selection";
import { assignRanks } from "./types";

function board(count: number) {
  return assignRanks(Array.from({ length: count }, (_, index) => ({
    participant: { uid: index + 1, nickname: `Player ${index + 1}`, username: `user${index + 1}` },
    total: count - index,
    tiebreak: 0,
    cells: {},
  })));
}

describe("排行榜搜索与分页", () => {
  it("按昵称或用户名搜索，不区分大小写，名次保持全榜名次", () => {
    const rows = board(12);
    const byName = selectStandings(rows, { q: " player 12 " }, null);
    expect(byName.rows.map(({ participant, rank }) => [participant.uid, rank])).toEqual([[12, 12]]);
    expect(byName.filtered).toBe(true);
    expect(selectStandings(rows, { q: "USER1" }, null).rows.map(({ participant }) => participant.uid))
      .toEqual([1, 10, 11, 12]);
  });

  it("分页只切出当前页，越界的页码取最近的一页", () => {
    const rows = board(PAGE_SIZE + 5);
    expect(selectStandings(rows, {}, null)).toMatchObject({ page: 1, pages: 2, matched: PAGE_SIZE + 5 });
    const last = selectStandings(rows, { page: "7" }, null);
    expect(last.page).toBe(2);
    expect(last.rows.map(({ rank }) => rank)).toEqual([51, 52, 53, 54, 55]);
  });

  it("我的排名取自全榜，不受搜索影响，并给出自己所在的页", () => {
    const rows = board(PAGE_SIZE + 5);
    const mine = selectStandings(rows, { q: "absent" }, PAGE_SIZE + 2).mine;
    expect(mine?.row.rank).toBe(PAGE_SIZE + 2);
    expect(mine?.page).toBe(2);
    expect(selectStandings(rows, {}, 999).mine).toBeNull();
    expect(selectStandings(rows, {}, null).mine).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { paginate } from "./paging";

const items = Array.from({ length: 7 }, (_, index) => index);

describe("paginate", () => {
  it("按页切片并报告总页数与总数", () => {
    expect(paginate(items, {}, 3)).toEqual({ items: [0, 1, 2], page: 1, pages: 3, total: 7 });
    expect(paginate(items, { page: "3" }, 3)).toEqual({ items: [6], page: 3, pages: 3, total: 7 });
  });

  it("读不懂的页码回到第一页，越过末页的停在末页", () => {
    for (const page of ["0", "-2", "x", "1.5", ""]) {
      expect(paginate(items, { page }, 3).page, page).toBe(1);
    }
    expect(paginate(items, { page: "99" }, 3)).toMatchObject({ page: 3, items: [6] });
  });

  it("空列表也有一页", () => {
    expect(paginate([], { page: "2" }, 3)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});

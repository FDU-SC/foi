import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar, FilterChips, SearchForm, type FilterRow } from "./filter-bar";
import { pageWindow, Pagination } from "./pagination";

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href.replaceAll("&amp;", "&"));
}

function render(rows: FilterRow[], params: Record<string, string | string[]>) {
  return renderToStaticMarkup(
    <FilterBar
      path="/list"
      params={params}
      rows={rows}
      searchKey="q"
      searchValue=""
      searchPlaceholder="搜索"
      filtered
    />,
  );
}

describe("FilterBar", () => {
  it("任何筛选变化都回到第一页，其余参数原样带着", () => {
    const html = render(
      [
        { key: "board", label: "方向", selected: [], choices: [{ value: "b", label: "B" }] },
        { key: "tag", label: "标签", multiple: true, selected: [], choices: [{ value: "x", label: "X" }] },
      ],
      { page: "3", section: "s", q: "k" },
    );

    expect(hrefs(html)).toContain("/list?section=s&q=k&board=b");
    expect(hrefs(html)).toContain("/list?section=s&q=k&tag=x");
    expect(html).not.toContain('name="page"');
    expect(html).toContain('name="section"');
  });
});

describe("可单独使用的搜索框与选项行", () => {
  it("搜索框带上其余参数、回到第一页；选项行只改自己的参数，再点已选的取消", () => {
    const search = renderToStaticMarkup(
      <SearchForm path="/list" params={{ board: "b", page: "2", q: "old" }} name="q" value="old" placeholder="搜索用户" />,
    );
    expect(search).toMatch(/type="hidden" name="board" value="b"/);
    expect(search).not.toMatch(/name="page"/);
    expect(search).not.toMatch(/type="hidden" name="q"/);

    const chips = renderToStaticMarkup(
      <FilterChips
        path="/list"
        params={{ board: "b", page: "2" }}
        row={{ key: "board", label: "榜单", selected: ["b"], choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }}
      />,
    );
    expect(hrefs(chips)).toEqual(["/list?board=a", "/list"]);
    expect(chips.match(/aria-current="true"/g)).toHaveLength(1);
  });
});

describe("Pagination", () => {
  it("只保留首末页与当前页邻居，其余折叠为省略号", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });

  it("单页不渲染，第一页的链接不带页码，其余参数保留", () => {
    expect(renderToStaticMarkup(<Pagination path="/list" params={{}} page={1} pages={1} />)).toBe("");
    const html = renderToStaticMarkup(<Pagination path="/list" params={{ q: "k", page: "2" }} page={2} pages={3} />);
    expect(hrefs(html)).toEqual(["/list?q=k", "/list?q=k", "/list?q=k&page=2", "/list?q=k&page=3", "/list?q=k&page=3"]);
    expect(html).toContain('aria-current="page"');
  });
});

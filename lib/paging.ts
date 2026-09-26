import { readOne, type SearchParams } from "@/lib/query";

export const PAGE_PARAM = "page";
export const PAGE_SIZE = 50;

export interface Page<T> {
  items: T[];

  /** 1-based and always within `1..pages`. */
  page: number;
  pages: number;

  /** How many items there are across every page. */
  total: number;
}

/** One page of `items`. An unreadable page reads as the first, one past the end as the last. */
export function paginate<T>(
  items: readonly T[],
  query: SearchParams,
  size = PAGE_SIZE,
): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const asked = Number(readOne(query, PAGE_PARAM));
  const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, pages) : 1;

  return {
    items: items.slice((page - 1) * size, page * size),
    page,
    pages,
    total: items.length,
  };
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PAGE_PARAM } from "@/lib/paging";
import { carried, toggled, withParam, without, type SearchParams } from "@/lib/query";
import { cn } from "@/lib/utils";

export interface FilterChoice {
  value: string;
  label: string;

  /** How many entries the choice would leave. Omit where a number says nothing. */
  count?: number;
}

export interface FilterRow {
  /** The query parameter this row writes. */
  key: string;

  label: string;
  choices: FilterChoice[];
  selected: string[];

  /** Choices accumulate. Without it, picking one replaces the last. */
  multiple?: boolean;

  /** The choice in effect while the parameter is absent; picking it drops it. */
  fallback?: string;
}

/**
 * A filter bar that works without JavaScript: every choice is a link to this
 * page with one parameter changed, and the search box is a GET form carrying
 * the rest along. Any change returns a paged list to its first page.
 */
export function FilterBar({
  path,
  params,
  rows,
  searchKey,
  searchValue,
  searchPlaceholder,
  filtered,
  clearHref = path,
}: {
  path: string;
  params: SearchParams;
  rows: FilterRow[];
  searchKey: string;
  searchValue: string;
  searchPlaceholder: string;
  filtered: boolean;

  /** Where clearing leads, for a page whose scope itself lives in the query. */
  clearHref?: string;
}) {
  const selected = rows
    .flatMap((row) => pickedIn(row).map((choice) => `${row.label}：${choice.label}`))
    .join(" · ");

  return (
    <div className="border-border bg-surface space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchForm path={path} params={params} name={searchKey} value={searchValue} placeholder={searchPlaceholder} />
        <div className="hidden flex-wrap gap-2 sm:flex">
          {rows.map((row) => {
            const picked = pickedIn(row);
            return (
              <details key={row.key} name="filter-bar" className="group relative">
                <summary
                  className={cn(
                    "flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-sm transition-colors select-none [&::-webkit-details-marker]:hidden",
                    picked.length > 0
                      ? "border-primary/40 bg-primary-subtle text-primary"
                      : "border-border text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {row.label}
                  {picked.length === 0 ? null : row.multiple ? (
                    <span className="bg-primary text-primary-fg rounded px-1.5 font-mono text-xs leading-5 tabular-nums">
                      {picked.length}
                    </span>
                  ) : (
                    <span className="max-w-32 truncate font-medium">{picked[0].label}</span>
                  )}
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0 transition-transform group-open:rotate-180">
                    <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="border-border bg-surface absolute top-full left-0 z-30 mt-1.5 flex max-h-80 w-72 max-w-[calc(100vw-2rem)] flex-wrap gap-2 overflow-y-auto rounded-lg border p-3 shadow-lg">
                  <FilterChips path={path} params={params} row={row} />
                </div>
              </details>
            );
          })}
        </div>
        {filtered ? (
          <Link href={clearHref} className="text-fg-muted text-xs underline underline-offset-2">
            清除筛选
          </Link>
        ) : null}
      </div>
      {selected ? <p className="text-fg-muted text-xs">{selected}</p> : null}
      <details className="sm:hidden">
        <summary className="text-primary cursor-pointer py-1 text-xs font-medium">
          筛选与排序{selected ? "" : " · 未筛选"}
        </summary>
        <div className="mt-2 space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-1.5">
              <span className="text-fg-muted w-10 shrink-0 text-xs font-medium">
                {row.label}
              </span>
              <FilterChips path={path} params={params} row={row} />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/** A GET search box that resends the page's other parameters and returns to the first page. */
export function SearchForm({
  path,
  params,
  name,
  value,
  placeholder,
}: {
  path: string;
  params: SearchParams;
  name: string;
  value: string;
  placeholder: string;
}) {
  return (
    <form action={path} className="flex min-w-0 flex-1 gap-2 sm:max-w-sm">
      {carried(params, name, PAGE_PARAM).map((field, index) => (
        <input key={index} type="hidden" name={field.name} value={field.value} />
      ))}
      <Input
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 min-w-0 flex-1 py-0"
        spellCheck={false}
      />
      <Button type="submit">搜索</Button>
    </form>
  );
}

/** One row's choices as links, each changing only that row's parameter. */
export function FilterChips({ path, params, row }: { path: string; params: SearchParams; row: FilterRow }) {
  return row.choices.map((choice) => (
    <Chip
      key={choice.value}
      choice={choice}
      active={row.selected.includes(choice.value)}
      href={path + hrefFor(row, choice, params)}
    />
  ));
}

function hrefFor(
  row: FilterRow,
  choice: FilterChoice,
  params: SearchParams,
): string {
  const base = without(params, PAGE_PARAM);
  if (row.multiple) return toggled(base, row.key, choice.value);

  const active = row.selected.includes(choice.value);
  const drop = active || choice.value === row.fallback;
  return withParam(base, row.key, drop ? undefined : choice.value);
}

function Chip({
  choice,
  active,
  href,
}: {
  choice: FilterChoice;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active || undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors",
        active
          ? "border-primary/50 bg-primary-subtle text-primary font-medium"
          : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
        choice.count === 0 && !active && "opacity-45",
      )}
    >
      {choice.label}
      {choice.count === undefined ? null : (
        <span className="font-mono text-xs tabular-nums opacity-60">
          {choice.count}
        </span>
      )}
    </Link>
  );
}

/** The choices a row has in effect beyond its default. */
function pickedIn(row: FilterRow): FilterChoice[] {
  return row.choices.filter(
    (choice) => row.selected.includes(choice.value) && choice.value !== row.fallback,
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { carried, toggled, withParam, type SearchParams } from "@/lib/query";
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
 * the rest along.
 */
export function ProblemFilters({
  path,
  params,
  rows,
  searchKey,
  searchValue,
  searchPlaceholder,
  filtered,
}: {
  path: string;
  params: SearchParams;
  rows: FilterRow[];
  searchKey: string;
  searchValue: string;
  searchPlaceholder: string;
  filtered: boolean;
}) {
  const selected = rows
    .flatMap((row) =>
      row.choices
        .filter(
          (choice) =>
            row.selected.includes(choice.value) &&
            choice.value !== row.fallback,
        )
        .map((choice) => `${row.label}：${choice.label}`),
    )
    .join(" · ");
  const choicesFor = (row: FilterRow) =>
    row.choices.map((choice) => (
      <Chip
        key={choice.value}
        choice={choice}
        active={row.selected.includes(choice.value)}
        href={path + hrefFor(row, choice, params)}
      />
    ));

  return (
    <div className="border-border bg-surface relative space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={path} className="flex min-w-0 flex-1 gap-2 sm:max-w-sm">
          {carried(params, searchKey).map((field, index) => (
            <input
              key={index}
              type="hidden"
              name={field.name}
              value={field.value}
            />
          ))}
          <Input
            name={searchKey}
            defaultValue={searchValue}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 min-w-0 flex-1 py-0"
            spellCheck={false}
          />
          <Button type="submit">搜索</Button>
        </form>
        <div className="hidden flex-wrap gap-2 sm:flex">
          {rows.map((row) => (
            <details key={row.key} name="problem-filter">
              <summary className="text-fg-muted hover:bg-surface-2 cursor-pointer rounded-md border px-3 py-2 text-xs">
                {row.label}
                {row.selected.length > 0 &&
                !row.selected.includes(row.fallback ?? "")
                  ? ` · ${row.selected.length}`
                  : ""}
              </summary>
              <div className="border-border bg-surface absolute top-full left-3 z-20 mt-1 flex max-h-72 w-72 max-w-[calc(100%-1.5rem)] flex-wrap gap-2 overflow-y-auto rounded-lg border p-3 shadow-md">
                {choicesFor(row)}
              </div>
            </details>
          ))}
        </div>
        {filtered ? (
          <Link
            href={path}
            className="text-fg-muted text-xs underline underline-offset-2"
          >
            清除筛选
          </Link>
        ) : null}
      </div>
      {selected ? <p className="text-fg-muted text-xs">{selected}</p> : null}
      <details className="sm:hidden">
        <summary className="text-primary cursor-pointer py-1 text-xs font-medium">
          筛选与排序{selected ? "" : " · 全部题目"}
        </summary>
        <div className="mt-2 space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-1.5">
              <span className="text-fg-muted w-10 shrink-0 text-xs font-medium">
                {row.label}
              </span>
              {choicesFor(row)}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function hrefFor(
  row: FilterRow,
  choice: FilterChoice,
  params: SearchParams,
): string {
  if (row.multiple) return toggled(params, row.key, choice.value);

  const active = row.selected.includes(choice.value);
  const drop = active || choice.value === row.fallback;
  return withParam(params, row.key, drop ? undefined : choice.value);
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
    <Link href={href} aria-current={active || undefined} className="rounded-md">
      <Badge
        tone={active ? "primary" : "neutral"}
        className={cn(
          "transition-colors",
          active
            ? "border-primary/50"
            : "hover:border-border-strong hover:text-fg",
          choice.count === 0 && !active && "opacity-45",
        )}
      >
        {choice.label}
        {choice.count === undefined ? null : (
          <span className="font-mono text-[10px] tabular-nums opacity-60">
            {choice.count}
          </span>
        )}
      </Badge>
    </Link>
  );
}

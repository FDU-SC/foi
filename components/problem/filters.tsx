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
  compact,
}: {
  path: string;
  params: SearchParams;
  rows: FilterRow[];
  searchKey: string;
  searchValue: string;
  searchPlaceholder: string;
  filtered: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface/70 space-y-3 rounded-xl border backdrop-blur-sm",
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <form action={path} className="flex min-w-0 flex-1 gap-2">
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
            className={cn("h-9 py-0", compact ? "min-w-0 flex-1" : "w-64")}
            spellCheck={false}
          />
          <Button type="submit">搜索</Button>
        </form>

        {filtered ? (
          <Link
            href={path}
            className="text-fg-subtle hover:text-fg text-xs underline underline-offset-2 transition-colors"
          >
            清除筛选
          </Link>
        ) : null}
      </div>

      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-center gap-1.5">
          <span className="text-fg-muted w-10 shrink-0 text-xs font-medium">
            {row.label}
          </span>
          {row.choices.map((choice) => (
            <Chip
              key={choice.value}
              choice={choice}
              active={row.selected.includes(choice.value)}
              href={path + hrefFor(row, choice, params)}
            />
          ))}
        </div>
      ))}
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
    <Link
      href={href}
      aria-current={active || undefined}
      className="rounded-md focus-visible:outline-none"
    >
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

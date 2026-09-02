import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { carried, type SearchParams } from "@/lib/query";

/**
 * A search box that works without JavaScript: a GET form pointed at the page
 * it sits on, carrying every parameter it does not own as a hidden field so
 * submitting narrows the page rather than resetting it.
 */
export function ProblemSearch({
  path,
  params,
  name,
  value,
  placeholder,
  filtered,
}: {
  path: string;
  params: SearchParams;
  name: string;
  value: string;
  placeholder: string;

  /** Whether anything is narrowing the page, and so whether to offer a way out. */
  filtered: boolean;
}) {
  return (
    <div className="border-border bg-surface/70 flex flex-wrap items-center gap-3 rounded-xl border p-4 backdrop-blur-sm">
      <form action={path} className="flex gap-2">
        {carried(params, name).map((field, index) => (
          <input
            key={index}
            type="hidden"
            name={field.name}
            value={field.value}
          />
        ))}
        <Input
          name={name}
          defaultValue={value}
          placeholder={placeholder}
          className="h-9 w-64 py-0"
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
  );
}
